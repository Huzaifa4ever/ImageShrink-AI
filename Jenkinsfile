
pipeline {
  agent any

  options {
    timestamps()
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
    timeout(time: 45, unit: 'MINUTES')
    disableConcurrentBuilds()
  }

  environment {
    ACR_NAME       = 'imageshrinkacr'
    ACR_LOGIN      = "${ACR_NAME}.azurecr.io"
    IMAGE_NAME     = 'imageshrink-api'
    RESOURCE_GROUP = 'imageshrink-rg'
    CONTAINER_APP  = 'imageshrink-api'

    KEEP_IMAGES    = '5'

    TRIVY_VERSION  = '0.69.3'
    MONGO_IMAGE    = 'mongo:7'
    TEST_MONGO     = 'imageshrink-ci-mongo'
  }

  stages {

    stage('Setup') {
      steps {
        script {
          env.GIT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_SHA}"
          env.IMAGE_REF = "${env.ACR_LOGIN}/${env.IMAGE_NAME}:${env.IMAGE_TAG}"
          currentBuild.displayName = "#${env.BUILD_NUMBER} · ${env.GIT_SHA}"
        }

        withCredentials([
          usernamePassword(credentialsId: 'azure-sp', usernameVariable: 'AZ_USER', passwordVariable: 'AZ_PASS'),
          string(credentialsId: 'azure-tenant', variable: 'AZ_TENANT')
        ]) {
          sh '''
            set -eu
            az login --service-principal -u "$AZ_USER" -p "$AZ_PASS" --tenant "$AZ_TENANT" --output none
            az account show --query name -o tsv
          '''
        }
      }
    }

    stage('Verify') {
      parallel {

        stage('Backend tests') {
          options { timeout(time: 12, unit: 'MINUTES') }
          steps {
            sh '''
              set -eu
              docker rm -f "$TEST_MONGO" >/dev/null 2>&1 || true
              docker run -d --name "$TEST_MONGO" -p 27017:27017 "$MONGO_IMAGE" >/dev/null

              for i in $(seq 1 30); do
                if docker exec "$TEST_MONGO" mongosh --quiet --eval 'db.runCommand({ping:1})' >/dev/null 2>&1; then
                  echo "mongo ready after ${i}s"; break
                fi
                [ "$i" = 30 ] && { echo "mongo never came up"; exit 1; }
                sleep 1
              done
            '''
            sh '''
              set -eu
              cd server
              python3 -m venv .ci-venv
              ./.ci-venv/bin/pip install --quiet --upgrade pip
              ./.ci-venv/bin/pip install --quiet -r requirements-dev.txt
              ./.ci-venv/bin/python -m pytest -q --junitxml=../pytest-report.xml
            '''
            sh '''
              set -eu
              if grep -q 'skipped="[1-9]' pytest-report.xml 2>/dev/null; then
                echo "ERROR: tests were skipped — MongoDB was probably not reachable."
                grep -o 'skipped="[0-9]*"' pytest-report.xml
                exit 1
              fi
            '''
          }
          post {
            always {
              junit allowEmptyResults: true, testResults: 'pytest-report.xml'
              sh 'docker rm -f "$TEST_MONGO" >/dev/null 2>&1 || true'
              sh 'rm -rf server/.ci-venv || true'
            }
          }
        }

        stage('Rule engine parity') {
          options { timeout(time: 8, unit: 'MINUTES') }
          steps {
            sh '''
              set -eu
              cd server
              python3 -m venv .parity-venv
              ./.parity-venv/bin/pip install --quiet --upgrade pip
              ./.parity-venv/bin/pip install --quiet -r requirements.txt
            '''
            sh '''
              set -eu
              cd vscode-extension
              npm ci --silent
              PARITY_PYTHON="$WORKSPACE/server/.parity-venv/bin/python" npm test
            '''
          }
          post {
            always {
              sh 'rm -rf server/.parity-venv || true'
            }
          }
        }

        stage('Frontend lint + typecheck') {
          options { timeout(time: 8, unit: 'MINUTES') }
          steps {
            sh '''
              set -eu
              cd client
              npm ci --silent
              npm run lint
              npx tsc -b --noEmit || npx tsc -b
            '''
          }
        }
      }
    }

    stage('Build image') {
      options { timeout(time: 20, unit: 'MINUTES') }
      steps {
        sh '''
          set -eu
          docker build \
            -f server/Dockerfile \
            --build-arg BAKE_TRIVY_DB=true \
            --build-arg TRIVY_DB_DATE="$(date +%Y-%m-%d)" \
            --label "org.opencontainers.image.revision=$GIT_SHA" \
            --label "org.opencontainers.image.version=$IMAGE_TAG" \
            -t "$IMAGE_REF" \
            .
          docker image inspect "$IMAGE_REF" --format 'built {{.RepoTags}} — {{.Size}} bytes'
        '''
      }
    }

    stage('Scan') {
      options { timeout(time: 15, unit: 'MINUTES') }
      steps {
        sh '''
          set -eu
          mkdir -p reports

          docker run --rm \
            -v /var/run/docker.sock:/var/run/docker.sock \
            -v "$HOME/.cache/trivy:/root/.cache/trivy" \
            "aquasec/trivy:$TRIVY_VERSION" image \
              --severity HIGH,CRITICAL \
              --ignore-unfixed \
              --exit-code 0 \
              --scanners vuln \
              --format table \
              "$IMAGE_REF" | tee reports/trivy-image.txt

          docker run --rm \
            -v "$(pwd):/src" \
            -v "$HOME/.cache/trivy:/root/.cache/trivy" \
            "aquasec/trivy:$TRIVY_VERSION" config \
              --severity HIGH,CRITICAL \
              --exit-code 0 \
              /src/server/Dockerfile | tee reports/trivy-dockerfile.txt
        '''
      }
      post {
        always {
          archiveArtifacts artifacts: 'reports/*.txt', allowEmptyArchive: true
        }
      }
    }

    stage('Push') {
      options { timeout(time: 15, unit: 'MINUTES') }
      steps {
        retry(3) {
          sh '''
            set -eu
            az acr login --name "$ACR_NAME" --output none
            docker push "$IMAGE_REF"
          '''
        }
      }
    }

    stage('Deploy API') {
      options { timeout(time: 12, unit: 'MINUTES') }
      steps {
        script {
          env.PREVIOUS_REVISION = sh(
            script: '''
              az containerapp revision list \
                --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
                --query "[?properties.active && properties.trafficWeight>\\`0\\`].name | [0]" \
                -o tsv 2>/dev/null || true
            ''',
            returnStdout: true
          ).trim()
          echo "currently serving: ${env.PREVIOUS_REVISION ?: '(none — first deploy)'}"
        }

        retry(2) {
          sh '''
            set -eu
            az containerapp update \
              --name "$CONTAINER_APP" \
              --resource-group "$RESOURCE_GROUP" \
              --image "$IMAGE_REF" \
              --set-env-vars "APP_BUILD=$IMAGE_TAG" \
              --output none
          '''
        }
      }
    }

    stage('Deploy web') {
      options { timeout(time: 12, unit: 'MINUTES') }
      steps {
        withCredentials([
          string(credentialsId: 'swa-deploy-token', variable: 'SWA_TOKEN'),
          string(credentialsId: 'vite-api-url', variable: 'VITE_API_URL'),
          string(credentialsId: 'vite-google-client-id', variable: 'VITE_GOOGLE_CLIENT_ID')
        ]) {
          sh '''
            set -eu
            cd client
            {
              echo "VITE_API_URL=$VITE_API_URL"
              echo "VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID"
            } > .env.production
            npm run build
            npx --yes @azure/static-web-apps-cli deploy ./dist \
              --deployment-token "$SWA_TOKEN" \
              --env production
          '''
        }
      }
    }

    stage('Verify deploy') {
      options { timeout(time: 10, unit: 'MINUTES') }
      steps {
        sh '''
          set -eu
          FQDN=$(az containerapp show --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
                   --query properties.configuration.ingress.fqdn -o tsv)
          echo "probing https://$FQDN/health"

          for i in $(seq 1 40); do
            BODY=$(curl -fsS --max-time 10 "https://$FQDN/health" 2>/dev/null || true)

            if printf '%s' "$BODY" | grep -q '"status":"ok"'; then
              RUNNING=$(printf '%s' "$BODY" | sed -n 's/.*"build":"\\([^"]*\\)".*/\\1/p')
              echo "healthy after $((i * 10))s — build ${RUNNING:-unknown}, expected $IMAGE_TAG"

              if [ -n "$RUNNING" ] && [ "$RUNNING" != "$IMAGE_TAG" ]; then
                sleep 10
                continue
              fi
              exit 0
            fi
            sleep 10
          done

          echo "never became healthy within 400s"
          exit 1
        '''
      }
      post {
        failure {
          script {
            if (env.PREVIOUS_REVISION) {
              echo "rolling back to ${env.PREVIOUS_REVISION}"
              sh '''
                set -eu
                az containerapp ingress traffic set \
                  --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
                  --revision-weight "$PREVIOUS_REVISION=100" --output none
              '''
            } else {
              echo 'No previous revision to roll back to — first deploy.'
            }
          }
        }
      }
    }

    stage('Prune registry') {
      options { timeout(time: 10, unit: 'MINUTES') }
      steps {
        sh '''
          set -eu
          az acr run --registry "$ACR_NAME" --cmd \
            "acr purge --filter '$IMAGE_NAME:.*' --keep $KEEP_IMAGES --untagged --ago 0d" \
            /dev/null || echo "purge skipped (non-fatal)"

          az acr repository show-tags --name "$ACR_NAME" --repository "$IMAGE_NAME" \
            --orderby time_desc -o tsv | head -10
        '''
      }
    }
  }

  post {
    always {
      sh '''
        docker image rm "$IMAGE_REF" >/dev/null 2>&1 || true
        docker image prune -f >/dev/null 2>&1 || true
        az logout >/dev/null 2>&1 || true
      '''
    }
    success {
      echo "Deployed ${env.IMAGE_TAG}"
    }
    failure {
      echo "Build ${env.BUILD_NUMBER} (${env.GIT_SHA}) failed. Rollback target was ${env.PREVIOUS_REVISION ?: 'n/a'}."
    }
  }
}
