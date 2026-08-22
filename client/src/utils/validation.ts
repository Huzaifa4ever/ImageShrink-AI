const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const DOCKERFILE_NAME_RE = /^((docker|container)file(\.[\w.-]+)?|[\w.-]+\.(docker|container)file)$/i;

export function validateDockerfileName(filename: string): string | null {
  const name = (filename || '').trim().replace(/\\/g, '/').split('/').pop() ?? '';
  if (!name) return 'That file has no name.';
  if (!DOCKERFILE_NAME_RE.test(name)) {
    return `'${name}' is not a Dockerfile. Choose a file named Dockerfile, Dockerfile.<something>, `
      + '<something>.Dockerfile or Containerfile - or use Paste Content instead.';
  }
  return null;
}

export function validateDockerfileContent(content: string): string | null {
  const meaningful = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (!meaningful.length) {
    return 'There is nothing to analyze - add the contents of a Dockerfile first.';
  }
  if (!meaningful.some((line) => /^FROM\s+\S/i.test(line))) {
    return 'This does not look like a Dockerfile: it has no FROM instruction, which every '
      + 'Dockerfile must start with. Paste the contents of a Dockerfile and try again.';
  }
  return null;
}

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

export function validateUsername(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Username is required';
  if (v.length < 3) return 'Username must be at least 3 characters';
  if (v.length > 32) return 'Username must be at most 32 characters';
  if (!USERNAME_RE.test(v)) {
    return 'Use only letters, numbers, dots, underscores or hyphens, starting with a letter or number';
  }
  return null;
}

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Email is required';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address';
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return 'Password is required';
  if (value.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (new TextEncoder().encode(value).length > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes`;
  }
  return null;
}
