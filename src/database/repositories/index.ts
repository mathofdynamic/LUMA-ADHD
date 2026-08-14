import type { D1Database } from "@cloudflare/workers-types";

import { createDatabaseClient } from "../client";
import { AgentRepository } from "./agents";
import { AgentTurnRepository } from "./agent-turns";
import { DocumentRepository } from "./documents";
import { EventRepository } from "./events";
import { HumanTaskRepository } from "./human-tasks";
import { JobRepository } from "./jobs";
import { TelegramIdentityRepository, ChatRepository, UserRepository } from "./identities";
import { MessageRepository } from "./messages";
import { ScheduledJobRepository } from "./scheduled-jobs";
import { ThreadLifecycleService, ThreadRepository } from "./threads";

export {
  AgentRepository,
  AgentTurnRepository,
  ChatRepository,
  DocumentRepository,
  EventRepository,
  HumanTaskRepository,
  JobRepository,
  MessageRepository,
  ScheduledJobRepository,
  TelegramIdentityRepository,
  ThreadLifecycleService,
  ThreadRepository,
  UserRepository,
};

export function createRepositories(database: D1Database) {
  const client = createDatabaseClient(database);
  const threads = new ThreadRepository(client);

  return {
    agents: new AgentRepository(client),
    agentTurns: new AgentTurnRepository(client),
    chats: new ChatRepository(client),
    documents: new DocumentRepository(client),
    events: new EventRepository(client),
    humanTasks: new HumanTaskRepository(client),
    jobs: new JobRepository(client),
    messages: new MessageRepository(client),
    scheduledJobs: new ScheduledJobRepository(client),
    telegramIdentities: new TelegramIdentityRepository(client),
    threads,
    threadLifecycle: new ThreadLifecycleService(threads),
    users: new UserRepository(client),
  };
}
