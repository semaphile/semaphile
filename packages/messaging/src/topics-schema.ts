// Shared by new-store initialization and the explicit offline 1.2 migration.
export const TOPICS_SCHEMA = `
CREATE TABLE subscriptions(name TEXT PRIMARY KEY,id TEXT UNIQUE NOT NULL,recipient TEXT UNIQUE NOT NULL,value TEXT NOT NULL,expires_at INTEGER,retired_at INTEGER);
CREATE INDEX subscription_expiry ON subscriptions(expires_at) WHERE retired_at IS NULL;
CREATE TABLE subscription_topics(topic TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(topic,name));
`;
