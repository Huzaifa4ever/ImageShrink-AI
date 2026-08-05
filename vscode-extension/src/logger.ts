

import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

export function initLogger(): vscode.LogOutputChannel {

  channel ??= vscode.window.createOutputChannel('ImageShrink AI', { log: true });
  return channel;
}

function get(): vscode.LogOutputChannel {
  return initLogger();
}

export const log = {
  trace: (message: string, ...args: unknown[]): void => get().trace(message, ...args),
  debug: (message: string, ...args: unknown[]): void => get().debug(message, ...args),
  info: (message: string, ...args: unknown[]): void => get().info(message, ...args),
  warn: (message: string, ...args: unknown[]): void => get().warn(message, ...args),
  error: (message: string | Error, ...args: unknown[]): void => get().error(message, ...args),
  show: (): void => get().show(true),
};
