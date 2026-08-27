import { readFile } from "node:fs/promises";
import path from "node:path";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { type ZodType, ZodError } from "zod";

import {
  addNoteSchema,
  replayInputSchema,
  setActiveStepSchema,
  setStepStatusSchema,
} from "./contracts.js";
import { InvalidReplayMutationError, ReplayNotFoundError, ReplayStore } from "./storage.js";

interface CreateAppOptions {
  store: ReplayStore;
  publicDirectory?: string | null;
  logger?: boolean;
}

type ReplayListener = (replayId: string) => void;

class InvalidRequestError extends Error {
  readonly issues: ZodError["issues"];

  constructor(error: ZodError) {
    super("Invalid request");
    this.issues = error.issues;
  }
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 100 * 1024 * 1024,
    logger: options.logger ?? false,
  });
  const subscribers = new Map<string, Set<NodeJS.WritableStream>>();
  const publish: ReplayListener = (replayId) => {
    const payload = `data: ${JSON.stringify({ type: "replay-updated", replayId })}\n\n`;
    for (const stream of subscribers.get(replayId) ?? []) stream.write(payload);
  };

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof InvalidRequestError) {
      return reply.status(400).send({ error: error.message, issues: error.issues });
    }
    if (error instanceof ReplayNotFoundError) {
      return reply.status(404).send({ error: error.message });
    }
    if (error instanceof InvalidReplayMutationError) {
      return reply.status(400).send({ error: error.message });
    }
    const normalizedError = error instanceof Error ? error : new Error("Unknown server error");
    const statusCode =
      "statusCode" in normalizedError && typeof normalizedError.statusCode === "number"
        ? normalizedError.statusCode
        : 500;
    if (statusCode >= 500) app.log.error(normalizedError);
    return reply
      .status(statusCode)
      .send({ error: statusCode < 500 ? normalizedError.message : "Internal server error" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/replays", async () => ({ replays: await options.store.list() }));

  app.post("/api/replays", async (request, reply) => {
    const replay = await options.store.sync(parseRequest(replayInputSchema, request.body));
    publish(replay.id);
    return reply.status(201).send({ replay, url: `/replays/${replay.id}` });
  });

  app.get<{ Params: { replayId: string } }>("/api/replays/:replayId", async (request) => ({
    replay: await options.store.get(request.params.replayId),
  }));

  app.get<{ Params: { replayId: string } }>(
    "/api/replays/:replayId/events",
    async (request, reply) => {
      await options.store.get(request.params.replayId);
      reply.hijack();
      reply.raw.writeHead(200, {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      });
      reply.raw.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
      const streams = subscribers.get(request.params.replayId) ?? new Set();
      streams.add(reply.raw);
      subscribers.set(request.params.replayId, streams);
      request.raw.on("close", () => {
        streams.delete(reply.raw);
        if (streams.size === 0) subscribers.delete(request.params.replayId);
      });
    },
  );

  app.patch<{ Params: { replayId: string } }>("/api/replays/:replayId/state", async (request) => {
    const { activeStepId } = parseRequest(setActiveStepSchema, request.body);
    const replay = await options.store.setActiveStep(request.params.replayId, activeStepId);
    publish(replay.id);
    return { replay };
  });

  app.patch<{ Params: { replayId: string; stepId: string } }>(
    "/api/replays/:replayId/steps/:stepId",
    async (request) => {
      const { status } = parseRequest(setStepStatusSchema, request.body);
      const replay = await options.store.setStepStatus(
        request.params.replayId,
        request.params.stepId,
        status,
      );
      publish(replay.id);
      return { replay };
    },
  );

  app.post<{ Params: { replayId: string } }>(
    "/api/replays/:replayId/notes",
    async (request, reply) => {
      const note = parseRequest(addNoteSchema, request.body);
      const replay = await options.store.addNote(request.params.replayId, note.text, note.stepId);
      publish(replay.id);
      return reply.status(201).send({ replay });
    },
  );

  app.delete<{ Params: { replayId: string; noteId: string } }>(
    "/api/replays/:replayId/notes/:noteId",
    async (request) => {
      const replay = await options.store.deleteNote(request.params.replayId, request.params.noteId);
      publish(replay.id);
      return { replay };
    },
  );

  if (options.publicDirectory) {
    await app.register(fastifyStatic, {
      index: false,
      root: options.publicDirectory,
      wildcard: false,
    });
    const indexHtml = await readFile(path.join(options.publicDirectory, "index.html"), "utf8");
    app.get("/", async (_request, reply) => reply.type("text/html").send(indexHtml));
    app.get<{ Params: { replayId: string } }>("/replays/:replayId", async (_request, reply) =>
      reply.type("text/html").send(indexHtml),
    );
  }

  await options.store.initialize();
  return app;
}

function parseRequest<T>(schema: ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) throw new InvalidRequestError(error);
    throw error;
  }
}
