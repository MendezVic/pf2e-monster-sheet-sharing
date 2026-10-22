import { MODULE_ID, SOCKET_NAME } from '@/constants';

type SocketKind = 'request' | 'result' | 'error' | 'broadcast';
type RequestHandler<TData, TResult> = (data: TData, senderId: string) => Promise<TResult> | TResult;
type BroadcastHandler<TData> = (data: TData, senderId: string) => Promise<void> | void;

interface BaseMessage {
  kind: SocketKind;
  requestId: string;
}

interface RequestMessage<TData = unknown> extends BaseMessage {
  kind: 'request';
  action: string;
  senderId: string;
  data: TData;
}

interface ResultMessage<TResult = unknown> extends BaseMessage {
  kind: 'result';
  targetId: string;
  data: TResult;
}

interface ErrorMessage extends BaseMessage {
  kind: 'error';
  targetId: string;
  error: string;
}

interface BroadcastMessage<TData = unknown> {
  kind: 'broadcast';
  action: string;
  senderId: string;
  data: TData;
}

type SocketMessage = RequestMessage | ResultMessage | ErrorMessage | BroadcastMessage;

const REQUEST_TIMEOUT_MS = 10_000;
const pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
const requestHandlers = new Map<string, RequestHandler<unknown, unknown>>();
const broadcastHandlers = new Map<string, BroadcastHandler<unknown>>();
let socketRegistered = false;

export function registerSocket(): void {
  if (socketRegistered) return;
  socketRegistered = true;
  game.socket.on(SOCKET_NAME, (message: SocketMessage) => void handleSocketMessage(message));
}

export function registerRequestHandler<TData, TResult>(action: string, handler: RequestHandler<TData, TResult>): void {
  requestHandlers.set(action, handler as RequestHandler<unknown, unknown>);
}

export function registerBroadcastHandler<TData>(action: string, handler: BroadcastHandler<TData>): void {
  broadcastHandlers.set(action, handler as BroadcastHandler<unknown>);
}

export function broadcast<TData>(action: string, data: TData): void {
  void handleBroadcast({ action, data, senderId: game.user.id });
  game.socket.emit(SOCKET_NAME, {
    kind: 'broadcast',
    action,
    senderId: game.user.id,
    data,
  } satisfies BroadcastMessage<TData>);
}

export async function dispatchRequest<TData, TResult>(action: string, data: TData): Promise<TResult> {
  if (game.user.isGM) return handleRequest({ action, data, senderId: game.user.id }) as Promise<TResult>;

  const requestId = foundry.utils.randomID();
  const promise = new Promise<TResult>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(game.i18n.localize(`${MODULE_ID}.errors.requestTimedOut`)));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(requestId, {
      resolve: (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value as TResult);
      },
      reject: (reason) => {
        globalThis.clearTimeout(timeout);
        reject(reason);
      },
    });
  });

  game.socket.emit(SOCKET_NAME, {
    kind: 'request',
    action,
    requestId,
    senderId: game.user.id,
    data,
  } satisfies RequestMessage<TData>);

  return promise;
}

async function handleSocketMessage(message: SocketMessage): Promise<void> {
  if (message.kind === 'broadcast') {
    await handleBroadcast(message);
    return;
  }

  if (message.kind === 'request') {
    if (!isPrimaryActiveGM()) return;
    await answerRequest(message);
    return;
  }

  if (message.targetId !== game.user.id) return;

  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;
  pendingRequests.delete(message.requestId);

  if (message.kind === 'result') {
    pending.resolve(message.data);
  } else {
    pending.reject(new Error(message.error));
  }
}

async function handleBroadcast<TData = unknown>(message: {
  action: string;
  data: TData;
  senderId: string;
}): Promise<void> {
  const handler = broadcastHandlers.get(message.action);
  if (handler) await handler(message.data, message.senderId);
}

function isPrimaryActiveGM(): boolean {
  if (!game.user.isGM) return false;

  const primaryGM = game.users
    .filter((user) => user.active && user.isGM)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  return primaryGM?.id === game.user.id;
}

async function answerRequest(message: RequestMessage): Promise<void> {
  try {
    const data = await handleRequest(message);
    game.socket.emit(SOCKET_NAME, {
      kind: 'result',
      requestId: message.requestId,
      targetId: message.senderId,
      data,
    } satisfies ResultMessage);
  } catch (error) {
    game.socket.emit(SOCKET_NAME, {
      kind: 'error',
      requestId: message.requestId,
      targetId: message.senderId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ErrorMessage);
  }
}

async function handleRequest<TData = unknown, TResult = unknown>(message: {
  action: string;
  data: TData;
  senderId: string;
}): Promise<TResult> {
  const handler = requestHandlers.get(message.action);
  if (!handler) throw new Error(`No handler registered for ${message.action}`);
  return handler(message.data, message.senderId) as Promise<TResult>;
}
