
String scopeFlag(String output, String key, String fallback) {
  String hit = output.readLines().find { it.startsWith(key + '=') }
  return hit == null ? fallback : hit.substring(key.length() + 1)
}

pipeline {
  agent any

  parameters {
    booleanParam(
      name: 'FULL_BUILD',
      defaultValue: false,
      description: 'Run every stage regardless of which files changed. Use when in doubt.'
    )
    booleanParam(
      name: 'REFRESH_CACHES',
      defaultValue: false,
      description: 'Reinstall npm and pip dependencies from scratch instead of reusing them.'
    )
  }

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

    // Must match the port the image actually listens on (server/Dockerfile: PORT=8000).
    TARGET_PORT    = '8000'

    KEEP_IMAGES    = '5'

    TRIVY_VERSION  = '0.69.3'
    MONGO_IMAGE    = 'mongo:7'
    TEST_MONGO     = 'imageshrink-ci-mongo'

    // Pinned rather than resolved at deploy time: `npx --yes <pkg>` would fetch whatever
    // version is newest that day and run it against a production deployment token.
    SWA_CLI_VERSION = '2.0.10'

    // BuildKit keeps its layer cache outside the image store, so routine image cleanup can
    // no longer delete it, and it builds the independent Dockerfile stages concurrently.
    DOCKER_BUILDKIT = '1'

    // One venv serves both test stages: requirements-dev.txt already includes
    // requirements.txt, so a second environment was installing the same packages twice.
    CI_VENV = 'server/.ci-venv'

    REFRESH_CACHES = "${params.REFRESH_CACHES}"
  }

  stages {

    stage('Setup') {
      steps {
        script {
          env.GIT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_SHA}"
          env.IMAGE_REF = "${env.ACR_LOGIN}/${env.IMAGE_NAME}:${env.IMAGE_TAG}"
          currentBuild.displayName = "#${env.BUILD_NUMBER} · ${env.GIT_SHA}"

          // Which stages this commit actually requires. The base is the last commit that
          // built green, so a fix after a red build still sees everything that changed since
          // the last known-good state, not just since the failure.
          def base = params.FULL_BUILD ? '' : (env.GIT_PREVIOUS_SUCCESSFUL_COMMIT ?: '')
          if (params.FULL_BUILD) {
            echo 'FULL_BUILD requested - change detection skipped.'
          }

          String scopes = sh(script: "sh ci/changed-scopes.sh ${base}", returnStdout: true).trim()

          env.REASON     = scopeFlag(scopes, 'REASON', 'unknown')
          env.BACKEND    = scopeFlag(scopes, 'BACKEND', 'true')
          env.FRONTEND   = scopeFlag(scopes, 'FRONTEND', 'true')
          env.PARITY     = scopeFlag(scopes, 'PARITY', 'true')
          env.DEPLOY_API = scopeFlag(scopes, 'DEPLOY_API', 'true')
          env.DEPLOY_WEB = scopeFlag(scopes, 'DEPLOY_WEB', 'true')

          env.NEEDS_AZURE = (env.DEPLOY_API == 'true' || env.DEPLOY_WEB == 'true') ? 'true' : 'false'

          currentBuild.description = "${env.REASON}: backend=${env.BACKEND} frontend=${env.FRONTEND} parity=${env.PARITY}"
          echo """selected work (${env.REASON}):
  backend tests   ${env.BACKEND}
  rule parity     ${env.PARITY}
  frontend checks ${env.FRONTEND}
  deploy API      ${env.DEPLOY_API}
  deploy web      ${env.DEPLOY_WEB}"""
        }

        // Skipped for a documentation-only commit: nothing downstream talks to Azure, so
        // there is no reason to exchange the service principal's credentials at all.
        script {
          if (env.NEEDS_AZURE == 'true') {
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
          } else {
            echo 'No Azure work in this build - skipping sign-in.'
          }
        }
      }
    }

    stage('Python deps') {
      when { expression { env.BACKEND == 'true' || env.PARITY == 'true' } }
      options { timeout(time: 10, unit: 'MINUTES') }
      steps {
        // Built once, before the parallel block, so the two test stages share it instead of
        // racing to create their own copy of the same packages.
        sh '''
          set -eu
          sh ci/cached-install.sh \
            --key server/requirements.txt \
            --key server/requirements-dev.txt \
            --dir "$CI_VENV" \
            -- sh -c '
              set -eu
              rm -rf "$CI_VENV"
              python3 -m venv "$CI_VENV"
              "$CI_VENV/bin/pip" install --quiet --upgrade pip
              "$CI_VENV/bin/pip" install --quiet -r server/requirements-dev.txt
            '
        '''
      }
    }

    stage('Verify') {
      parallel {

        stage('Backend tests') {
          when { expression { env.BACKEND == 'true' } }
          options { timeout(time: 12, unit: 'MINUTES') }
          steps {
            sh '''
              set -eu
              # The workspace is reused between builds, so a report left by an earlier build
              # would otherwise be republished as if it belonged to this one.
              rm -f pytest-report.xml

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
              "$WORKSPACE/$CI_VENV/bin/python" -m pytest -q --junitxml=../pytest-report.xml
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
            }
          }
        }

        stage('Rule engine parity') {
          when { expression { env.PARITY == 'true' } }
          options { timeout(time: 8, unit: 'MINUTES') }
          steps {
            sh '''
              set -eu
              sh ci/cached-install.sh \
                --key vscode-extension/package-lock.json \
                --dir vscode-extension/node_modules \
                -- sh -c 'cd vscode-extension && npm ci --silent --no-audit --no-fund'
            '''
            sh '''
              set -eu
              cd vscode-extension
              PARITY_PYTHON="$WORKSPACE/$CI_VENV/bin/python" npm test
            '''
          }
        }

        stage('Frontend lint + typecheck') {
          when { expression { env.FRONTEND == 'true' } }
          options { timeout(time: 8, unit: 'MINUTES') }
          steps {
            sh '''
              set -eu
              sh ci/cached-install.sh \
                --key client/package-lock.json \
                --dir client/node_modules \
                -- sh -c 'cd client && npm ci --silent --no-audit --no-fund'
            '''
            sh '''
              set -eu
              cd client
              npm run lint
              npx tsc -b --noEmit || npx tsc -b
            '''
          }
        }
      }
    }

    stage('Build image') {
      when { expression { env.BACKEND == 'true' } }
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
      when { expression { env.BACKEND == 'true' } }
      options { timeout(time: 15, unit: 'MINUTES') }
      steps {
        sh '''
          set -eu
          rm -rf reports
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
      when { expression { env.DEPLOY_API == 'true' } }
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
      when { expression { env.DEPLOY_API == 'true' } }
      options { timeout(time: 12, unit: 'MINUTES') }
      steps {
        sh '''
          set -eu
          az containerapp identity assign \
            --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
            --system-assigned --output none
          az containerapp registry set \
            --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
            --server "$ACR_LOGIN" --identity system --output none

          # Deploying a new image does not touch ingress, so a target port left over from
          # whatever the app was first created with (the quickstart sample listens on 80)
          # silently survives every deploy: the revision goes Healthy, and ingress forwards
          # to a port nothing listens on. Assert the port the image really serves instead.
          az containerapp ingress update \
            --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
            --target-port "$TARGET_PORT" --output none
        '''

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
          env.PREVIOUS_IMAGE = sh(
            script: '''
              az containerapp revision list \
                --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
                --query "[?properties.active && properties.trafficWeight>\\`0\\`].properties.template.containers[0].image | [0]" \
                -o tsv 2>/dev/null || true
            ''',
            returnStdout: true
          ).trim()
          echo "currently serving: ${env.PREVIOUS_REVISION ?: '(none — first deploy)'} (${env.PREVIOUS_IMAGE ?: 'no image'})"
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
      when { expression { env.DEPLOY_WEB == 'true' } }
      options { timeout(time: 12, unit: 'MINUTES') }
      steps {
        withCredentials([
          string(credentialsId: 'swa-deploy-token', variable: 'SWA_TOKEN'),
          string(credentialsId: 'vite-api-url', variable: 'VITE_API_URL'),
          string(credentialsId: 'vite-google-client-id', variable: 'VITE_GOOGLE_CLIENT_ID')
        ]) {
          sh '''
            set -eu
            # Free when the Frontend stage already installed for this lockfile; does the work
            # when that stage was skipped because only the backend changed.
            sh ci/cached-install.sh \
              --key client/package-lock.json \
              --dir client/node_modules \
              -- sh -c 'cd client && npm ci --silent --no-audit --no-fund'

            cd client
            {
              echo "VITE_API_URL=$VITE_API_URL"
              echo "VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID"
            } > .env.production
            npm run build
            npx --yes "@azure/static-web-apps-cli@$SWA_CLI_VERSION" deploy ./dist \
              --deployment-token "$SWA_TOKEN" \
              --env production
          '''
        }
      }
    }

    stage('Verify deploy') {
      when { expression { env.DEPLOY_API == 'true' } }
      options { timeout(time: 10, unit: 'MINUTES') }
      steps {
        sh '''
          set -eu
          FQDN=$(az containerapp show --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
                   --query properties.configuration.ingress.fqdn -o tsv)
          echo "probing https://$FQDN/health"

          # A new revision usually answers in well under a minute, but a flat 10s pause meant
          # a deploy that was ready at 22s was still reported at 30s. Poll quickly at first,
          # then back off: same total patience (~9 min), less waiting on the common case.
          CODE=000
          ELAPSED=0
          for i in $(seq 1 60); do
            if [ "$i" -le 10 ]; then STEP=3; else STEP=10; fi
            # Keep the status code and the body. Discarding them (curl -f ... 2>/dev/null)
            # makes every failure look identical: "never became healthy" cannot tell a
            # crashing container (503) from a wrong ingress port or a bad path (404).
            CODE=$(curl -s -o /tmp/health.$$ -w '%{http_code}' --max-time 10 "https://$FQDN/health") || CODE=000
            BODY=$(cat /tmp/health.$$ 2>/dev/null || true)

            if [ "$CODE" = 200 ] && printf '%s' "$BODY" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
              RUNNING=$(printf '%s' "$BODY" | sed -n 's/.*"build"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')
              echo "healthy after ${ELAPSED}s - build ${RUNNING:-unknown}, expected $IMAGE_TAG"

              if [ -n "$RUNNING" ] && [ "$RUNNING" != "$IMAGE_TAG" ]; then
                sleep "$STEP"; ELAPSED=$((ELAPSED + STEP))
                continue
              fi
              rm -f /tmp/health.$$
              exit 0
            fi

            if [ $((i % 5)) = 1 ]; then
              echo "  ${ELAPSED}s: HTTP $CODE $(printf '%s' "$BODY" | tr -d '\\n' | cut -c1-200)"
            fi
            sleep "$STEP"; ELAPSED=$((ELAPSED + STEP))
          done

          rm -f /tmp/health.$$
          echo "never became healthy within ${ELAPSED}s - last status HTTP $CODE"
          echo "  000 = nothing answered; 404 = wrong path or ingress port; 503 = no replica running"
          exit 1
        '''
      }
      post {
        failure {
          sh '''
            echo "--- ingress ---"
            az containerapp show --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
              --query "properties.configuration.ingress.{fqdn:fqdn,targetPort:targetPort,external:external}" \
              -o json || true

            echo "--- revisions ---"
            az containerapp revision list --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
              --query "[].{name:name,active:properties.active,created:properties.createdTime,state:properties.provisioningState,health:properties.healthState,replicas:properties.replicas}" \
              -o table || true

            REV=$(az containerapp show --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
                    --query properties.latestRevisionName -o tsv 2>/dev/null || true)

            if [ -n "$REV" ]; then
              echo "--- system log ($REV) — why the replica did or did not start ---"
              az containerapp logs show --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
                --revision "$REV" --type system --tail 30 || true

              echo "--- container log ($REV) — what the app itself printed ---"
              az containerapp logs show --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
                --revision "$REV" --tail 100 || true
            else
              echo "(no revision name available — skipping logs)"
            fi
          '''

          script {
            if (env.PREVIOUS_IMAGE?.startsWith(env.ACR_LOGIN)) {
              echo "rolling back to ${env.PREVIOUS_IMAGE}"
              sh '''
                set -eu
                az containerapp update \
                  --name "$CONTAINER_APP" --resource-group "$RESOURCE_GROUP" \
                  --image "$PREVIOUS_IMAGE" --output none
              '''
            } else {
              echo "Not rolling back — previous image was ${env.PREVIOUS_IMAGE ?: '(none)'}, not one of ours."
            }
          }
        }
      }
    }

    stage('Prune registry') {
      when { expression { env.DEPLOY_API == 'true' } }
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
        docker builder prune -f --keep-storage=10GB >/dev/null 2>&1 || true
        docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true
        az logout >/dev/null 2>&1 || true
      '''
    }
    success {
      script {
        if (env.REASON == 'docs-only') {
          echo 'Documentation-only commit - no build or deploy was needed.'
        } else if (env.DEPLOY_API == 'true' || env.DEPLOY_WEB == 'true') {
          echo "Deployed ${env.IMAGE_TAG} (api=${env.DEPLOY_API}, web=${env.DEPLOY_WEB})"
        } else {
          echo 'Checks passed. Nothing required deployment.'
        }
      }
    }
    failure {
      echo "Build ${env.BUILD_NUMBER} (${env.GIT_SHA}) failed. Rollback target was ${env.PREVIOUS_REVISION ?: 'n/a'}."
    }
  }
}
