import { PassThrough } from "stream";
import * as eventBus from "../lib/eventBus";
import logger from "../lib/logger";
import { heartbeat } from "../lib/constants";

interface PassThroughWithHeaders extends PassThrough {
  headers: { [key: string]: string };
}

module.exports.install = (server: any) => {
  server.route({
    method: "GET",
    path: "/events",
    handler: streamEventsHandler
  });

  server.route({
    method: "POST",
    path: "/events/{id}",
    options: {
      payload: { allow: "application/json" }
    },
    handler: postEventHandler(postEventToken())
  });
};

const postEventToken = (): string => {
  let token = process.env.AUTH_TOKEN as string;
  if (token) return token;

  token = require("crypto")
    .randomBytes(20)
    .toString("base64")
    .replace(/\W/g, "");

  logger.warn(
    "No AUTH_TOKEN was specified, using random token %s for authentication.",
    token
  );

  return token;
};

const streamEventsHandler = (req: any, h: any) => {
  const stream = new PassThrough() as PassThroughWithHeaders;
  stream.headers = {
    "content-type": "text/event-stream",
    "content-encoding": "identity"
  };

  const subscriber = (event: eventBus.Event) => {
    const outEvent = { ...event } as any;
    outEvent.updatedAt = event.updatedAt.getTime();

    stream.write(`data: ${JSON.stringify(outEvent)}\n\n`);
  };

  const sendHeartBeat = setInterval(() => {
    stream.write(`data: ${heartbeat}\n\n`);
  }, 20 * 1000);

  eventBus.subscribe(subscriber);
  eventBus.replayHistory(subscriber);

  stream.once("close", () => {
    eventBus.unsubscribe(subscriber);
    clearInterval(sendHeartBeat);
  });

  stream.write("\n\n");
  return stream;
};

const postEventHandler = (token: string) => (req: any, h: any) => {
  if (`bearer ${token}` !== req.headers.authorization) {
    return h.response("Unauthorized").code(401);
  }

  eventBus.publish(req.params.id, req.payload);
  return "OK";
};