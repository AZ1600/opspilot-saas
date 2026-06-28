import type { PoolClient } from "pg";
import { getPlan } from "@/lib/billing";
import { demoWorkspace } from "@/lib/demo-data";
import { getDatabasePool, withTransaction } from "@/lib/server/database";
import type {
  AuthenticatedIdentity,
  BillingState,
  DecisionStatus,
  ExecutionStatus,
  InboxImport,
  InboxScanInsert,
  IngestionInsert,
  ResolvedSession,
  ScanInsert,
  StripeBillingUpdate,
  StripeCustomerBillingUpdate,
  WorkspaceRepository,
} from "@/lib/server/workspace-repository";
import { createWorkspaceFromOnboarding } from "@/lib/workspace-factory";
import type {
  ActionStatus,
  BillingPlan,
  BusinessAction,
  ConnectedAccount,
  CustomerRisk,
  ExecutionJob,
  ImpactEntry,
  InboxMessage,
  IngestionRecord,
  KnowledgeDocument,
  OnboardingProfile,
  PainPoint,
  RevenueLeak,
  TeamInvite,
  TeamMember,
  TimelineEvent,
  WorkspaceSettings,
  WorkspaceSnapshot,
  WorkspaceUser,
} from "@/lib/types";

type DatabaseClient = PoolClient | ReturnType<typeof getDatabasePool>;

type BusinessRow = {
  id: string;
  name: string;
  niche: string;
  onboarding_completed: boolean;
  primary_pain_point: PainPoint;
  billing_plan: BillingPlan["id"];
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
};

type UserRow = {
  id: string;
  business_id: string;
  auth_provider: string | null;
  auth_user_id: string | null;
  email: string;
  full_name: string;
  role: TeamMember["role"];
  status: TeamMember["status"];
  invited_at: Date | string | null;
};

type ActionRow = {
  id: string;
  title: string;
  source: BusinessAction["source"];
  customer_name: string;
  priority: BusinessAction["priority"];
  status: ActionStatus;
  estimated_value_cents: number;
  age_label: string;
  summary: string;
  draft: string;
  reason_codes: string[];
};

type RevenueLeakRow = {
  id: string;
  source: string;
  issue: string;
  customer_name: string;
  value_cents: number;
  age_label: string;
  next_move: string;
};

type CustomerRiskRow = {
  id: string;
  customer_name: string;
  risk_level: CustomerRisk["level"];
  monthly_value_cents: number;
  reason: string;
  next_move: string;
};

type ConnectedAccountRow = {
  id: string;
  provider: ConnectedAccount["provider"];
  status: ConnectedAccount["status"];
  account_label: string;
  created_at: Date | string;
  last_imported_at: Date | string | null;
  message: string | null;
};

type InboxMessageRow = {
  id: string;
  sender: string;
  subject: string;
  received_label: string;
  preview: string;
  body: string;
  status: InboxMessage["status"];
  estimated_value_cents: number;
};

type IngestionRow = {
  id: string;
  source: IngestionRecord["source"];
  classifier: IngestionRecord["classifier"];
  raw_text: string;
  detected_category: IngestionRecord["detectedCategory"];
  summary: string;
  created_at: Date | string;
};

type KnowledgeDocumentRow = {
  id: string;
  title: string;
  document_type: KnowledgeDocument["type"];
  body: string;
};

type TimelineEventRow = {
  id: string;
  title: string;
  due_label: string;
  owner: string;
  risk_level: TimelineEvent["risk"];
};

type ApprovalEventRow = {
  id: string;
  action_id: string;
  action_title: string;
  decision: DecisionStatus;
  actor_name: string;
  created_at: Date | string;
};

type ImpactEntryRow = {
  id: string;
  action_id: string;
  action_title: string;
  category: ImpactEntry["category"];
  customer_name: string;
  source: ImpactEntry["source"];
  amount_cents: number;
  time_saved_minutes: number;
  confidence: ImpactEntry["confidence"];
  note: string;
  created_at: Date | string;
};

type ExecutionJobRow = {
  id: string;
  action_id: string;
  action_title: string;
  job_type: ExecutionJob["type"];
  status: ExecutionJob["status"];
  customer_name: string;
  owner_name: string;
  detail: string;
  created_at: Date | string;
  updated_at: Date | string;
};

async function readWorkspaceFromDatabase(
  client: DatabaseClient,
  businessId: string,
): Promise<WorkspaceSnapshot | null> {
  const businessResult = await client.query<BusinessRow>(
    "select * from businesses where id = $1",
    [businessId],
  );
  const business = businessResult.rows[0];

  if (!business) {
    return null;
  }

  const [
    users,
    actions,
    revenueLeaks,
    customerRisks,
    connectedAccounts,
    inboxMessages,
    ingestions,
    knowledgeDocuments,
    timeline,
    approvalEvents,
    impactEntries,
    executionJobs,
  ] = await Promise.all([
    client.query<UserRow>(
      "select * from users where business_id = $1 order by created_at asc",
      [businessId],
    ),
    client.query<ActionRow>(
      "select * from business_actions where business_id = $1 order by created_at desc",
      [businessId],
    ),
    client.query<RevenueLeakRow>(
      "select * from revenue_leaks where business_id = $1 order by created_at desc",
      [businessId],
    ),
    client.query<CustomerRiskRow>(
      "select * from customer_risks where business_id = $1 order by created_at desc",
      [businessId],
    ),
    client.query<ConnectedAccountRow>(
      "select * from connected_accounts where business_id = $1 order by created_at asc",
      [businessId],
    ),
    client.query<InboxMessageRow>(
      "select * from inbox_messages where business_id = $1 order by created_at asc",
      [businessId],
    ),
    client.query<IngestionRow>(
      "select * from ingestions where business_id = $1 order by created_at desc",
      [businessId],
    ),
    client.query<KnowledgeDocumentRow>(
      "select * from knowledge_documents where business_id = $1 order by created_at asc",
      [businessId],
    ),
    client.query<TimelineEventRow>(
      "select * from timeline_events where business_id = $1 order by created_at asc",
      [businessId],
    ),
    client.query<ApprovalEventRow>(
      "select * from approval_events where business_id = $1 order by created_at desc",
      [businessId],
    ),
    client.query<ImpactEntryRow>(
      "select * from impact_entries where business_id = $1 order by created_at desc",
      [businessId],
    ),
    client.query<ExecutionJobRow>(
      "select * from execution_jobs where business_id = $1 order by created_at desc",
      [businessId],
    ),
  ]);

  const teamMembers = users.rows.map(mapUser);
  const owner = teamMembers.find((user) => user.role === "owner") ?? teamMembers[0];

  return {
    businessId: business.id,
    businessName: business.name,
    niche: business.niche,
    onboardingCompleted: business.onboarding_completed,
    primaryPainPoint: business.primary_pain_point,
    billingPlan: getPlan(business.billing_plan),
    currentUser: owner ?? demoWorkspace.currentUser,
    teamMembers,
    actions: actions.rows.map(mapAction),
    revenueLeaks: revenueLeaks.rows.map(mapRevenueLeak),
    customerRisks: customerRisks.rows.map(mapCustomerRisk),
    connectedAccounts: connectedAccounts.rows.map(mapConnectedAccount),
    inboxMessages: inboxMessages.rows.map(mapInboxMessage),
    ingestions: ingestions.rows.map(mapIngestion),
    knowledgeDocuments: knowledgeDocuments.rows.map(mapKnowledgeDocument),
    timeline: timeline.rows.map(mapTimelineEvent),
    approvalEvents: approvalEvents.rows.map((row) => ({
      id: row.id,
      actionId: row.action_id,
      actionTitle: row.action_title,
      decision: row.decision,
      actor: row.actor_name,
      createdAt: toIso(row.created_at),
    })),
    impactEntries: impactEntries.rows.map(mapImpactEntry),
    executionJobs: executionJobs.rows.map(mapExecutionJob),
  };
}

async function replaceWorkspace(
  client: PoolClient,
  workspace: WorkspaceSnapshot,
) {
  await client.query("delete from businesses where id = $1", [
    workspace.businessId,
  ]);

  await client.query(
    `insert into businesses
      (id, name, niche, onboarding_completed, primary_pain_point, billing_plan)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      workspace.businessId,
      workspace.businessName,
      workspace.niche,
      workspace.onboardingCompleted,
      workspace.primaryPainPoint,
      workspace.billingPlan.id,
    ],
  );

  for (const member of workspace.teamMembers) {
    await insertUser(client, workspace.businessId, member);
  }

  await insertWorkspaceCollections(client, workspace);
}

async function insertWorkspaceCollections(
  client: PoolClient,
  workspace: WorkspaceSnapshot,
) {
  for (const action of workspace.actions) {
    await insertAction(client, workspace.businessId, action);
  }

  for (const leak of workspace.revenueLeaks) {
    await insertRevenueLeak(client, workspace.businessId, leak);
  }

  for (const risk of workspace.customerRisks) {
    await insertCustomerRisk(client, workspace.businessId, risk);
  }

  for (const account of workspace.connectedAccounts) {
    await insertConnectedAccount(client, workspace.businessId, account);
  }

  for (const message of workspace.inboxMessages) {
    await insertInboxMessage(client, workspace.businessId, message);
  }

  for (const ingestion of workspace.ingestions) {
    await insertIngestion(client, workspace.businessId, ingestion);
  }

  for (const document of workspace.knowledgeDocuments) {
    await insertKnowledgeDocument(client, workspace.businessId, document);
  }

  for (const event of workspace.timeline) {
    await insertTimelineEvent(client, workspace.businessId, event);
  }

  for (const impact of workspace.impactEntries) {
    await insertImpactEntry(client, workspace.businessId, impact);
  }

  for (const job of workspace.executionJobs) {
    await insertExecutionJob(client, workspace.businessId, job);
  }
}

async function ensureWorkspace(businessId: string) {
  return withTransaction(async (client) => {
    const existing = await readWorkspaceFromDatabase(client, businessId);

    if (existing) {
      return existing;
    }

    const seed = {
      ...demoWorkspace,
      businessId,
      currentUser: {
        ...demoWorkspace.currentUser,
        businessId,
      },
      teamMembers: demoWorkspace.teamMembers.map((member) => ({
        ...member,
        businessId,
      })),
    };

    await replaceWorkspace(client, seed);
    return seed;
  });
}

async function read(businessId: string) {
  return ensureWorkspace(businessId);
}

async function resolveAuthenticatedSession(
  identity: AuthenticatedIdentity,
): Promise<ResolvedSession> {
  return withTransaction(async (client) => {
    await ensureAuthIdentitySchema(client);

    const byIdentity = await client.query<UserRow>(
      `select * from users
       where auth_provider = $1 and auth_user_id = $2
       limit 1`,
      [identity.provider, identity.providerUserId],
    );
    const identityUser = byIdentity.rows[0];

    if (identityUser) {
      return sessionFromUser(identityUser);
    }

    const byEmail = await client.query<UserRow>(
      "select * from users where lower(email) = $1 limit 1",
      [identity.email.toLowerCase()],
    );
    const emailUser = byEmail.rows[0];

    if (emailUser) {
      await attachAuthIdentity(client, emailUser.id, identity);
      return sessionFromUser({
        ...emailUser,
        auth_provider: identity.provider,
        auth_user_id: identity.providerUserId,
        status: "active",
      });
    }

    const businessId = `business-${slugifyIdentity(identity.providerUserId)}`;
    const owner: TeamMember = {
      id: `${identity.provider}-${identity.providerUserId}`,
      businessId,
      email: identity.email,
      fullName: identity.fullName,
      role: "owner",
      status: "active",
    };
    const seed = {
      ...demoWorkspace,
      businessId,
      onboardingCompleted: false,
      currentUser: owner,
      teamMembers: [owner],
    };

    await replaceWorkspace(client, seed);
    await attachAuthIdentity(client, owner.id, identity);

    return {
      businessId,
      user: owner,
    };
  });
}

async function reset(businessId: string) {
  return withTransaction(async (client) => {
    const workspace = {
      ...demoWorkspace,
      businessId,
      currentUser: {
        ...demoWorkspace.currentUser,
        businessId,
      },
      teamMembers: demoWorkspace.teamMembers.map((member) => ({
        ...member,
        businessId,
      })),
    };

    await replaceWorkspace(client, workspace);
    return workspace;
  });
}

async function onboard(
  businessId: string,
  profile: OnboardingProfile,
  owner?: WorkspaceUser,
) {
  return withTransaction(async (client) => {
    await ensureAuthIdentitySchema(client);
    const existingOwnerAuth = owner
      ? await authIdentityForUser(client, owner.id, owner.email)
      : null;
    const workspace = createWorkspaceFromOnboarding(businessId, profile, owner);
    await replaceWorkspace(client, workspace);

    if (owner && existingOwnerAuth) {
      await client.query(
        `update users
         set auth_provider = $3, auth_user_id = $4, status = 'active'
         where business_id = $1 and id = $2`,
        [
          businessId,
          owner.id,
          existingOwnerAuth.auth_provider,
          existingOwnerAuth.auth_user_id,
        ],
      );
    }

    return workspace;
  });
}

async function updateSettings(
  businessId: string,
  settings: WorkspaceSettings,
) {
  return withTransaction(async (client) => {
    await ensureWorkspaceInTransaction(client, businessId);
    await client.query(
      `update businesses
       set name = $2, niche = $3, primary_pain_point = $4
       where id = $1`,
      [
        businessId,
        settings.businessName,
        settings.niche,
        settings.primaryPainPoint,
      ],
    );
    await client.query(
      `update users
       set full_name = $2
       where business_id = $1 and role = 'owner'`,
      [businessId, settings.ownerName],
    );
    await client.query(
      `update knowledge_documents
       set body = $2
       where business_id = $1 and id = 'doc-002'`,
      [
        businessId,
        `OpsPilot should prioritize ${settings.primaryPainPoint.replaceAll("_", " ")} for ${settings.businessName}.`,
      ],
    );

    return readWorkspaceFromDatabaseOrThrow(client, businessId);
  });
}

async function updateBillingPlan(
  businessId: string,
  planId: BillingPlan["id"],
) {
  return withTransaction(async (client) => {
    await ensureWorkspaceInTransaction(client, businessId);
    await client.query(
      "update businesses set billing_plan = $2 where id = $1",
      [businessId, planId],
    );
    return readWorkspaceFromDatabaseOrThrow(client, businessId);
  });
}

async function readBillingState(businessId: string): Promise<BillingState> {
  return withTransaction(async (client) => {
    await ensureBillingSchema(client);
    await ensureWorkspaceInTransaction(client, businessId);

    const result = await client.query<
      Pick<
        BusinessRow,
        "stripe_customer_id" | "stripe_subscription_id" | "subscription_status"
      >
    >(
      `select stripe_customer_id, stripe_subscription_id, subscription_status
       from businesses
       where id = $1`,
      [businessId],
    );
    const row = result.rows[0];

    return {
      stripeCustomerId: row?.stripe_customer_id ?? null,
      stripeSubscriptionId: row?.stripe_subscription_id ?? null,
      subscriptionStatus: row?.subscription_status ?? null,
    };
  });
}

async function updateStripeBilling(update: StripeBillingUpdate) {
  await withTransaction(async (client) => {
    await ensureBillingSchema(client);
    await ensureWorkspaceInTransaction(client, update.businessId);
    await client.query(
      `update businesses
       set billing_plan = $2,
           stripe_customer_id = $3,
           stripe_subscription_id = $4,
           subscription_status = $5
       where id = $1`,
      [
        update.businessId,
        update.planId,
        update.customerId,
        update.subscriptionId,
        update.status,
      ],
    );
  });
}

async function updateStripeBillingByCustomer(
  update: StripeCustomerBillingUpdate,
) {
  await withTransaction(async (client) => {
    await ensureBillingSchema(client);
    await client.query(
      `update businesses
       set billing_plan = $2,
           stripe_subscription_id = $3,
           subscription_status = $4
       where stripe_customer_id = $1`,
      [
        update.customerId,
        update.planId,
        update.subscriptionId,
        update.status,
      ],
    );
  });
}

async function inviteTeamMember(businessId: string, invite: TeamInvite) {
  return withTransaction(async (client) => {
    await ensureWorkspaceInTransaction(client, businessId);
    const email = invite.email.trim().toLowerCase();
    const existing = await client.query(
      "select id from users where business_id = $1 and lower(email) = $2",
      [businessId, email],
    );

    if (existing.rowCount === 0) {
      await insertUser(client, businessId, {
        id: `user-${Date.now()}`,
        businessId,
        email,
        fullName: invite.fullName.trim(),
        role: invite.role,
        status: "invited",
        invitedAt: new Date().toISOString(),
      });
    }

    return readWorkspaceFromDatabaseOrThrow(client, businessId);
  });
}

async function addScan(businessId: string, scan: ScanInsert) {
  return withTransaction(async (client) => {
    await ensureWorkspaceInTransaction(client, businessId);

    for (const action of scan.actions) {
      await insertAction(client, businessId, action);
    }

    for (const leak of scan.revenueLeaks) {
      await insertRevenueLeak(client, businessId, leak);
    }

    return readWorkspaceFromDatabaseOrThrow(client, businessId);
  });
}

async function addIngestion(
  businessId: string,
  ingestion: IngestionInsert,
) {
  return withTransaction(async (client) => {
    await ensureWorkspaceInTransaction(client, businessId);
    await insertIngestionBundle(client, businessId, ingestion);
    return readWorkspaceFromDatabaseOrThrow(client, businessId);
  });
}

async function addInboxScan(businessId: string, scan: InboxScanInsert) {
  return withTransaction(async (client) => {
    await ensureWorkspaceInTransaction(client, businessId);
    await insertIngestionBundle(client, businessId, scan);
    await client.query(
      "update inbox_messages set status = 'scanned' where business_id = $1 and id = any($2)",
      [businessId, scan.scannedMessageIds],
    );
    return readWorkspaceFromDatabaseOrThrow(client, businessId);
  });
}

async function upsertConnectedAccount(
  businessId: string,
  account: ConnectedAccount,
) {
  return withTransaction(async (client) => {
    await ensureWorkspaceInTransaction(client, businessId);
    await insertConnectedAccount(client, businessId, account);
    return readWorkspaceFromDatabaseOrThrow(client, businessId);
  });
}

async function importInboxMessages(
  businessId: string,
  inboxImport: InboxImport,
) {
  return withTransaction(async (client) => {
    await ensureWorkspaceInTransaction(client, businessId);
    await insertConnectedAccount(client, businessId, inboxImport.account);

    for (const message of inboxImport.messages) {
      await insertInboxMessage(client, businessId, message);
    }

    return readWorkspaceFromDatabaseOrThrow(client, businessId);
  });
}

async function updateActionDecision(
  businessId: string,
  actionId: string,
  status: DecisionStatus,
  actor: string,
) {
  return withTransaction(async (client) => {
    await ensureWorkspaceInTransaction(client, businessId);
    const actionResult = await client.query<ActionRow>(
      "select * from business_actions where business_id = $1 and id = $2",
      [businessId, actionId],
    );
    const action = actionResult.rows[0];

    if (!action) {
      return null;
    }

    await client.query(
      "update business_actions set status = $3 where business_id = $1 and id = $2",
      [businessId, actionId, status],
    );

    const actorUser = await firstUserForBusiness(client, businessId);
    await client.query(
      `insert into approval_events
        (id, business_id, action_id, user_id, action_title, decision, actor_name)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `approval-${Date.now()}`,
        businessId,
        actionId,
        actorUser.id,
        action.title,
        status,
        actor,
      ],
    );

    if (status === "approved") {
      await client.query(
        "delete from impact_entries where business_id = $1 and action_id = $2",
        [businessId, actionId],
      );
      await insertImpactEntry(client, businessId, createImpactEntry(mapAction(action)));
      await client.query(
        "delete from execution_jobs where business_id = $1 and action_id = $2",
        [businessId, actionId],
      );
      await insertExecutionJob(
        client,
        businessId,
        createExecutionJob(mapAction(action), actor),
      );
    }

    return readWorkspaceFromDatabaseOrThrow(client, businessId);
  });
}

async function updateExecutionJobStatus(
  businessId: string,
  jobId: string,
  status: ExecutionStatus,
) {
  return withTransaction(async (client) => {
    await ensureWorkspaceInTransaction(client, businessId);
    const result = await client.query(
      `update execution_jobs
       set status = $3, updated_at = now()
       where business_id = $1 and id = $2`,
      [businessId, jobId, status],
    );

    if (result.rowCount === 0) {
      return null;
    }

    return readWorkspaceFromDatabaseOrThrow(client, businessId);
  });
}

async function insertIngestionBundle(
  client: PoolClient,
  businessId: string,
  ingestion: IngestionInsert,
) {
  await insertIngestion(client, businessId, ingestion.ingestion);

  for (const action of ingestion.actions) {
    await insertAction(client, businessId, action);
  }

  for (const leak of ingestion.revenueLeaks) {
    await insertRevenueLeak(client, businessId, leak);
  }

  for (const risk of ingestion.customerRisks) {
    await insertCustomerRisk(client, businessId, risk);
  }
}

async function ensureWorkspaceInTransaction(
  client: PoolClient,
  businessId: string,
) {
  const existing = await readWorkspaceFromDatabase(client, businessId);

  if (!existing) {
    const seed = {
      ...demoWorkspace,
      businessId,
      currentUser: {
        ...demoWorkspace.currentUser,
        businessId,
      },
      teamMembers: demoWorkspace.teamMembers.map((member) => ({
        ...member,
        businessId,
      })),
    };

    await replaceWorkspace(client, seed);
  }
}

async function readWorkspaceFromDatabaseOrThrow(
  client: PoolClient,
  businessId: string,
) {
  const workspace = await readWorkspaceFromDatabase(client, businessId);

  if (!workspace) {
    throw new Error(`Workspace ${businessId} was not found after database write.`);
  }

  return workspace;
}

async function firstUserForBusiness(client: PoolClient, businessId: string) {
  const result = await client.query<UserRow>(
    "select * from users where business_id = $1 order by created_at asc limit 1",
    [businessId],
  );
  const user = result.rows[0];

  if (!user) {
    throw new Error(`Business ${businessId} has no users.`);
  }

  return user;
}

let authIdentitySchemaReady = false;
let billingSchemaReady = false;

async function ensureAuthIdentitySchema(client: PoolClient) {
  if (authIdentitySchemaReady) {
    return;
  }

  await client.query("alter table users add column if not exists auth_provider text");
  await client.query("alter table users add column if not exists auth_user_id text");
  await client.query(
    `create unique index if not exists users_auth_identity_idx
     on users (auth_provider, auth_user_id)
     where auth_provider is not null and auth_user_id is not null`,
  );
  authIdentitySchemaReady = true;
}

async function ensureBillingSchema(client: PoolClient) {
  if (billingSchemaReady) {
    return;
  }

  await client.query("alter table businesses add column if not exists stripe_customer_id text");
  await client.query("alter table businesses add column if not exists stripe_subscription_id text");
  await client.query("alter table businesses add column if not exists subscription_status text");
  await client.query(
    `create index if not exists businesses_stripe_customer_idx
     on businesses (stripe_customer_id)
     where stripe_customer_id is not null`,
  );
  billingSchemaReady = true;
}

async function authIdentityForUser(
  client: PoolClient,
  userId: string,
  email: string,
) {
  const result = await client.query<Pick<UserRow, "auth_provider" | "auth_user_id">>(
    `select auth_provider, auth_user_id
     from users
     where id = $1 or lower(email) = $2
     order by case when id = $1 then 0 else 1 end
     limit 1`,
    [userId, email.toLowerCase()],
  );
  const authIdentity = result.rows[0];

  if (!authIdentity?.auth_provider || !authIdentity.auth_user_id) {
    return null;
  }

  return authIdentity;
}

async function attachAuthIdentity(
  client: PoolClient,
  userId: string,
  identity: AuthenticatedIdentity,
) {
  await client.query(
    `update users
     set auth_provider = $2,
         auth_user_id = $3,
         email = $4,
         full_name = $5,
         status = 'active',
         invited_at = null
     where id = $1`,
    [
      userId,
      identity.provider,
      identity.providerUserId,
      identity.email.toLowerCase(),
      identity.fullName,
    ],
  );
}

function sessionFromUser(user: UserRow): ResolvedSession {
  return {
    businessId: user.business_id,
    user: {
      id: user.id,
      businessId: user.business_id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    },
  };
}

async function insertUser(
  client: PoolClient,
  businessId: string,
  member: TeamMember,
) {
  await client.query(
    `insert into users
      (id, business_id, email, full_name, role, status, invited_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      member.id,
      businessId,
      member.email,
      member.fullName,
      member.role,
      member.status,
      member.invitedAt ?? null,
    ],
  );
}

async function insertAction(
  client: PoolClient,
  businessId: string,
  action: BusinessAction,
) {
  await client.query(
    `insert into business_actions
      (id, business_id, title, source, customer_name, priority, status,
       estimated_value_cents, age_label, summary, draft, reason_codes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (business_id, id) do update set
       status = excluded.status,
       summary = excluded.summary,
       draft = excluded.draft`,
    [
      action.id,
      businessId,
      action.title,
      action.source,
      action.customer,
      action.priority,
      action.status,
      toCents(action.value),
      action.age,
      action.summary,
      action.draft,
      action.reasonCodes,
    ],
  );
}

async function insertRevenueLeak(
  client: PoolClient,
  businessId: string,
  leak: RevenueLeak,
) {
  await client.query(
    `insert into revenue_leaks
      (id, business_id, source, issue, customer_name, value_cents, age_label, next_move)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (business_id, id) do nothing`,
    [
      leak.id,
      businessId,
      leak.source,
      leak.issue,
      leak.customer,
      toCents(leak.value),
      leak.age,
      leak.nextMove,
    ],
  );
}

async function insertCustomerRisk(
  client: PoolClient,
  businessId: string,
  risk: CustomerRisk,
) {
  await client.query(
    `insert into customer_risks
      (id, business_id, customer_name, risk_level, monthly_value_cents, reason, next_move)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (business_id, id) do nothing`,
    [
      risk.id,
      businessId,
      risk.name,
      risk.level,
      toCents(risk.value),
      risk.reason,
      risk.nextMove,
    ],
  );
}

async function insertConnectedAccount(
  client: PoolClient,
  businessId: string,
  account: ConnectedAccount,
) {
  await client.query(
    `insert into connected_accounts
      (id, business_id, provider, status, account_label, last_imported_at, message)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (business_id, id) do update set
       status = excluded.status,
       account_label = excluded.account_label,
       last_imported_at = excluded.last_imported_at,
       message = excluded.message`,
    [
      account.id,
      businessId,
      account.provider,
      account.status,
      account.accountLabel,
      account.lastImportedAt ?? null,
      account.message ?? null,
    ],
  );
}

async function insertInboxMessage(
  client: PoolClient,
  businessId: string,
  message: InboxMessage,
) {
  await client.query(
    `insert into inbox_messages
      (id, business_id, sender, subject, received_label, preview, body, status, estimated_value_cents)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (business_id, id) do update set status = excluded.status`,
    [
      message.id,
      businessId,
      message.from,
      message.subject,
      message.receivedAt,
      message.preview,
      message.body,
      message.status,
      toCents(message.estimatedValue),
    ],
  );
}

async function insertIngestion(
  client: PoolClient,
  businessId: string,
  ingestion: IngestionRecord,
) {
  await client.query(
    `insert into ingestions
      (id, business_id, source, classifier, raw_text, detected_category, summary, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (business_id, id) do nothing`,
    [
      ingestion.id,
      businessId,
      ingestion.source,
      ingestion.classifier,
      ingestion.rawText,
      ingestion.detectedCategory,
      ingestion.summary,
      ingestion.createdAt,
    ],
  );
}

async function insertKnowledgeDocument(
  client: PoolClient,
  businessId: string,
  document: KnowledgeDocument,
) {
  await client.query(
    `insert into knowledge_documents
      (id, business_id, title, document_type, body)
     values ($1, $2, $3, $4, $5)
     on conflict (business_id, id) do update set body = excluded.body`,
    [document.id, businessId, document.title, document.type, document.body],
  );
}

async function insertTimelineEvent(
  client: PoolClient,
  businessId: string,
  event: TimelineEvent,
) {
  await client.query(
    `insert into timeline_events
      (id, business_id, title, due_label, owner, risk_level)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (business_id, id) do nothing`,
    [event.id, businessId, event.title, event.time, event.owner, event.risk],
  );
}

async function insertImpactEntry(
  client: PoolClient,
  businessId: string,
  impact: ImpactEntry,
) {
  await client.query(
    `insert into impact_entries
      (id, business_id, action_id, action_title, category, customer_name, source,
       amount_cents, time_saved_minutes, confidence, note, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (business_id, id) do nothing`,
    [
      impact.id,
      businessId,
      impact.actionId,
      impact.actionTitle,
      impact.category,
      impact.customer,
      impact.source,
      toCents(impact.amount),
      impact.timeSavedMinutes,
      impact.confidence,
      impact.note,
      impact.createdAt,
    ],
  );
}

async function insertExecutionJob(
  client: PoolClient,
  businessId: string,
  job: ExecutionJob,
) {
  await client.query(
    `insert into execution_jobs
      (id, business_id, action_id, action_title, job_type, status,
       customer_name, owner_name, detail, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (business_id, id) do update set
       status = excluded.status,
       detail = excluded.detail,
       updated_at = excluded.updated_at`,
    [
      job.id,
      businessId,
      job.actionId,
      job.actionTitle,
      job.type,
      job.status,
      job.customer,
      job.owner,
      job.detail,
      job.createdAt,
      job.updatedAt,
    ],
  );
}

function mapUser(row: UserRow): TeamMember {
  return {
    id: row.id,
    businessId: row.business_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    ...(row.invited_at ? { invitedAt: toIso(row.invited_at) } : {}),
  };
}

function mapAction(row: ActionRow): BusinessAction {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    customer: row.customer_name,
    value: fromCents(row.estimated_value_cents),
    priority: row.priority,
    status: row.status,
    age: row.age_label,
    summary: row.summary,
    draft: row.draft,
    reasonCodes: row.reason_codes ?? [],
  };
}

function mapRevenueLeak(row: RevenueLeakRow): RevenueLeak {
  return {
    id: row.id,
    source: row.source,
    issue: row.issue,
    customer: row.customer_name,
    value: fromCents(row.value_cents),
    age: row.age_label,
    nextMove: row.next_move,
  };
}

function mapCustomerRisk(row: CustomerRiskRow): CustomerRisk {
  return {
    id: row.id,
    name: row.customer_name,
    level: row.risk_level,
    value: fromCents(row.monthly_value_cents),
    reason: row.reason,
    nextMove: row.next_move,
  };
}

function mapConnectedAccount(row: ConnectedAccountRow): ConnectedAccount {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    accountLabel: row.account_label,
    connectedAt: toIso(row.created_at),
    ...(row.last_imported_at ? { lastImportedAt: toIso(row.last_imported_at) } : {}),
    ...(row.message ? { message: row.message } : {}),
  };
}

function mapInboxMessage(row: InboxMessageRow): InboxMessage {
  return {
    id: row.id,
    from: row.sender,
    subject: row.subject,
    receivedAt: row.received_label,
    preview: row.preview,
    body: row.body,
    status: row.status,
    estimatedValue: fromCents(row.estimated_value_cents),
  };
}

function mapIngestion(row: IngestionRow): IngestionRecord {
  return {
    id: row.id,
    source: row.source,
    classifier: row.classifier,
    rawText: row.raw_text,
    detectedCategory: row.detected_category,
    summary: row.summary,
    createdAt: toIso(row.created_at),
  };
}

function mapKnowledgeDocument(row: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    title: row.title,
    type: row.document_type,
    body: row.body,
  };
}

function mapTimelineEvent(row: TimelineEventRow): TimelineEvent {
  return {
    id: row.id,
    title: row.title,
    time: row.due_label,
    owner: row.owner,
    risk: row.risk_level,
  };
}

function mapImpactEntry(row: ImpactEntryRow): ImpactEntry {
  return {
    id: row.id,
    actionId: row.action_id,
    actionTitle: row.action_title,
    category: row.category,
    customer: row.customer_name,
    source: row.source,
    amount: fromCents(row.amount_cents),
    timeSavedMinutes: row.time_saved_minutes,
    confidence: row.confidence,
    note: row.note,
    createdAt: toIso(row.created_at),
  };
}

function mapExecutionJob(row: ExecutionJobRow): ExecutionJob {
  return {
    id: row.id,
    actionId: row.action_id,
    actionTitle: row.action_title,
    type: row.job_type,
    status: row.status,
    customer: row.customer_name,
    owner: row.owner_name,
    detail: row.detail,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function createExecutionJob(action: BusinessAction, actor: string): ExecutionJob {
  const now = new Date().toISOString();
  const type = executionTypeFor(action);

  return {
    id: `exec-${Date.now()}`,
    actionId: action.id,
    actionTitle: action.title,
    type,
    status: "queued",
    customer: action.customer,
    owner: actor,
    detail: executionDetailFor(type, action),
    createdAt: now,
    updatedAt: now,
  };
}

function executionTypeFor(action: BusinessAction): ExecutionJob["type"] {
  const reasonText = action.reasonCodes.join(" ").toLowerCase();
  const title = action.title.toLowerCase();

  if (reasonText.includes("invoice") || title.includes("invoice")) {
    return "invoice_reminder";
  }

  if (reasonText.includes("complaint") || reasonText.includes("churn")) {
    return "customer_recovery";
  }

  if (action.source === "Gmail" || action.source === "Customer messages") {
    return "send_email";
  }

  return "create_follow_up";
}

function executionDetailFor(
  type: ExecutionJob["type"],
  action: BusinessAction,
) {
  if (type === "invoice_reminder") {
    return `Queue invoice/payment follow-up for ${action.customer}.`;
  }

  if (type === "customer_recovery") {
    return `Queue recovery response and owner follow-up for ${action.customer}.`;
  }

  if (type === "send_email") {
    return `Queue approved email draft for ${action.customer}.`;
  }

  return `Create follow-up task for ${action.customer}.`;
}

function createImpactEntry(action: BusinessAction): ImpactEntry {
  const category = impactCategoryFor(action);

  return {
    id: `impact-${Date.now()}`,
    actionId: action.id,
    actionTitle: action.title,
    category,
    customer: action.customer,
    source: action.source,
    amount: category === "time_saved" ? 0 : action.value,
    timeSavedMinutes: category === "time_saved" ? 45 : 25,
    confidence: "estimated",
    note: impactNoteFor(category, action),
    createdAt: new Date().toISOString(),
  };
}

function impactCategoryFor(action: BusinessAction): ImpactEntry["category"] {
  const reasonText = action.reasonCodes.join(" ").toLowerCase();
  const title = action.title.toLowerCase();

  if (reasonText.includes("complaint") || reasonText.includes("churn")) {
    return "protected_revenue";
  }

  if (reasonText.includes("invoice") || title.includes("invoice")) {
    return "invoice_follow_up";
  }

  if (action.value <= 0) {
    return "time_saved";
  }

  return "recovered_revenue";
}

function impactNoteFor(
  category: ImpactEntry["category"],
  action: BusinessAction,
) {
  if (category === "protected_revenue") {
    return `Approved intervention may protect ${action.customer} revenue.`;
  }

  if (category === "invoice_follow_up") {
    return `Approved follow-up moves ${action.customer} invoice recovery forward.`;
  }

  if (category === "time_saved") {
    return "Approved action reduces manual operations follow-up.";
  }

  return `Approved action may recover revenue from ${action.customer}.`;
}

function toCents(value: number) {
  return Math.round(value * 100);
}

function fromCents(value: number) {
  return Math.round(value / 100);
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function slugifyIdentity(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || `user-${Date.now()}`;
}

export const postgresWorkspaceRepository: WorkspaceRepository = {
  read,
  resolveAuthenticatedSession,
  reset,
  onboard,
  updateSettings,
  updateBillingPlan,
  readBillingState,
  updateStripeBilling,
  updateStripeBillingByCustomer,
  inviteTeamMember,
  addScan,
  addIngestion,
  addInboxScan,
  upsertConnectedAccount,
  importInboxMessages,
  updateExecutionJobStatus,
  updateActionDecision,
};
