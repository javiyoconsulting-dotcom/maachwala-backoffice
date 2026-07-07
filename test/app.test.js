const assert = require('node:assert/strict');
const test = require('node:test');
const { createApp, decodePubSubMessage, extractOrgId, validateOnboardOrgPayload } = require('../src/app');
const { getGithubDispatchConfig, triggerGithubDispatch } = require('../src/githubDispatch');
const { mapOrganizationToContractedOrg } = require('../src/organizationRepository');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, () => resolve(server.address().port));
  });
}

test('valid onboard organization request returns 201', async () => {
  const savedOrganizations = [];
  const repository = {
    async createOrganization(organization) {
      savedOrganizations.push(organization);
      return {
        id: 1,
        name: organization.name,
        usercount: organization.headcount,
        businessregion: organization.businessregion,
        businesstype: organization.businesstype,
        status: true,
        data: organization.data,
        number: 1783123456789,
        createdAt: '2026-07-04T00:00:00.000Z',
      };
    },
  };
  const server = createApp({ repository });
  const port = await listen(server);

  try {
    const response = await fetch(`http://localhost:${port}/backoffice/onboardorg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'demo',
        headcount: 4,
        businessregion: 1,
        businesstype: 2,
        data: {
          owner: 'name',
          ownerphone: 9875352512,
        },
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(body.message, 'Organization onboarded successfully');
    assert.equal(body.organization.name, 'demo');
    assert.equal(body.organization.usercount, 4);
    assert.equal(body.organization.businessregion, 1);
    assert.equal(body.organization.businesstype, 2);
    assert.equal(body.organization.status, true);
    assert.equal(body.organization.data.owner, 'name');
    assert.deepEqual(savedOrganizations, [
      {
        name: 'demo',
        headcount: 4,
        businessregion: 1,
        businesstype: 2,
        data: {
          owner: 'name',
          ownerphone: 9875352512,
        },
      },
    ]);
  } finally {
    server.close();
  }
});

test('preflight request returns CORS headers', async () => {
  const server = createApp();
  const port = await listen(server);

  try {
    const response = await fetch(`http://localhost:${port}/backoffice/onboardorg`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS');
    assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type,Authorization');
  } finally {
    server.close();
  }
});

test('createddl Pub/Sub endpoint triggers Terraform dispatch', async () => {
  const dispatches = [];
  const server = createApp({
    async dispatchTerraformPipeline(payload) {
      dispatches.push(payload);
    },
  });
  const port = await listen(server);

  try {
    const response = await fetch(`http://localhost:${port}/backoffice/createddl/pubsub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          messageId: 'message-1',
          publishTime: '2026-07-07T00:00:00Z',
          attributes: {
            reason: 'createorg-ddl',
          },
          data: Buffer.from(JSON.stringify({ orgid: 'org-123', requestedBy: 'pubsub-test' })).toString('base64'),
        },
        subscription: 'BACKOFFICE_CREATEORG_CREATEDDL-sub',
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.message, 'Terraform DDL pipeline trigger accepted');
    assert.equal(body.orgid, 'org-123');
    assert.deepEqual(dispatches, [
      {
        source: 'pubsub',
        topic: 'BACKOFFICE_CREATEORG_CREATEDDL',
        subscription: 'BACKOFFICE_CREATEORG_CREATEDDL-sub',
        orgid: 'org-123',
        messageId: 'message-1',
        publishTime: '2026-07-07T00:00:00Z',
        attributes: {
          reason: 'createorg-ddl',
        },
        data: {
          orgid: 'org-123',
          requestedBy: 'pubsub-test',
        },
      },
    ]);
  } finally {
    server.close();
  }
});

test('createddl Pub/Sub endpoint rejects messages without orgid', async () => {
  const originalConsoleError = console.error;
  console.error = () => {};

  const server = createApp({
    async dispatchTerraformPipeline() {
      throw new Error('dispatch should not be called');
    },
  });
  const port = await listen(server);

  try {
    const response = await fetch(`http://localhost:${port}/backoffice/createddl/pubsub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          messageId: 'message-missing-org',
          data: Buffer.from(JSON.stringify({ requestedBy: 'pubsub-test' })).toString('base64'),
        },
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Pub/Sub message must include orgid');
  } finally {
    console.error = originalConsoleError;
    server.close();
  }
});

test('createddl Pub/Sub endpoint logs dispatch failures', async () => {
  const originalConsoleError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);

  const server = createApp({
    async dispatchTerraformPipeline() {
      throw Object.assign(new Error('dispatch failed'), {
        statusCode: 502,
        details: 'bad gateway from GitHub',
      });
    },
  });
  const port = await listen(server);

  try {
    const response = await fetch(`http://localhost:${port}/backoffice/createddl/pubsub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          messageId: 'message-dispatch-failed',
          data: Buffer.from(JSON.stringify({ orgid: 'org-500' })).toString('base64'),
        },
        subscription: 'BACKOFFICE_CREATEORG_CREATEDDL-sub',
      }),
    });

    const body = await response.json();
    const logPrefix = 'DDL_TRIGGER_ERROR ';
    const log = JSON.parse(logs[0][0].slice(logPrefix.length));

    assert.equal(response.status, 502);
    assert.equal(body.error, 'dispatch failed');
    assert.equal(logs[0][0].startsWith(logPrefix), true);
    assert.equal(logs[1][0] instanceof Error, true);
    assert.equal(log.message, 'Failed to process /backoffice/createddl/pubsub request');
    assert.equal(log.event, 'DDL_TRIGGER_ERROR');
    assert.equal(log.severity, 'ERROR');
    assert.equal(log.error.name, 'Error');
    assert.equal(log.error.message, 'dispatch failed');
    assert.equal(log.error.statusCode, 502);
    assert.equal(log.error.details, 'bad gateway from GitHub');
    assert.equal(typeof log.error.stack, 'string');
    assert.equal(log.orgid, 'org-500');
    assert.equal(log.pubsubMessageId, 'message-dispatch-failed');
  } finally {
    console.error = originalConsoleError;
    server.close();
  }
});

test('decodes Pub/Sub message data as JSON when possible', () => {
  const decoded = decodePubSubMessage({
    message: {
      message_id: 'message-2',
      data: Buffer.from(JSON.stringify({ action: 'apply-ddl' })).toString('base64'),
    },
    subscription: 'BACKOFFICE_CREATEORG_CREATEDDL-sub',
  });

  assert.deepEqual(decoded, {
    messageId: 'message-2',
    publishTime: undefined,
    attributes: {},
    data: {
      action: 'apply-ddl',
    },
    subscription: 'BACKOFFICE_CREATEORG_CREATEDDL-sub',
  });
});

test('extracts orgid from data aliases and attributes', () => {
  assert.equal(extractOrgId({ data: { orgid: 'org-1' }, attributes: {} }), 'org-1');
  assert.equal(extractOrgId({ data: { orgId: 'org-2' }, attributes: {} }), 'org-2');
  assert.equal(extractOrgId({ data: { org_id: 'org-3' }, attributes: {} }), 'org-3');
  assert.equal(extractOrgId({ data: {}, attributes: { orgid: 'org-4' } }), 'org-4');
});

test('GitHub dispatch config accepts either token environment variable', () => {
  const originalGithubDispatchToken = process.env.GITHUB_DISPATCH_TOKEN;
  const originalGhRepositoryDispatchToken = process.env.GH_REPOSITORY_DISPATCH_TOKEN;

  try {
    delete process.env.GITHUB_DISPATCH_TOKEN;
    process.env.GH_REPOSITORY_DISPATCH_TOKEN = 'fallback-token';

    const config = getGithubDispatchConfig();

    assert.equal(config.token, 'fallback-token');
    assert.equal(config.tokenEnv, 'GH_REPOSITORY_DISPATCH_TOKEN');
  } finally {
    if (originalGithubDispatchToken === undefined) {
      delete process.env.GITHUB_DISPATCH_TOKEN;
    } else {
      process.env.GITHUB_DISPATCH_TOKEN = originalGithubDispatchToken;
    }

    if (originalGhRepositoryDispatchToken === undefined) {
      delete process.env.GH_REPOSITORY_DISPATCH_TOKEN;
    } else {
      process.env.GH_REPOSITORY_DISPATCH_TOKEN = originalGhRepositoryDispatchToken;
    }
  }
});

test('GitHub dispatch reports missing token environment variables', async () => {
  const originalGithubDispatchToken = process.env.GITHUB_DISPATCH_TOKEN;
  const originalGhRepositoryDispatchToken = process.env.GH_REPOSITORY_DISPATCH_TOKEN;

  try {
    delete process.env.GITHUB_DISPATCH_TOKEN;
    delete process.env.GH_REPOSITORY_DISPATCH_TOKEN;

    await assert.rejects(
      () => triggerGithubDispatch({ orgid: 'org-1' }),
      (error) => {
        assert.equal(error.message, 'GitHub dispatch token is not configured');
        assert.equal(error.statusCode, 500);
        assert.deepEqual(error.details.expectedEnvVars, [
          'GITHUB_DISPATCH_TOKEN',
          'GH_REPOSITORY_DISPATCH_TOKEN',
        ]);
        assert.equal(error.details.hasGithubDispatchToken, false);
        assert.equal(error.details.hasGhRepositoryDispatchToken, false);
        return true;
      },
    );
  } finally {
    if (originalGithubDispatchToken === undefined) {
      delete process.env.GITHUB_DISPATCH_TOKEN;
    } else {
      process.env.GITHUB_DISPATCH_TOKEN = originalGithubDispatchToken;
    }

    if (originalGhRepositoryDispatchToken === undefined) {
      delete process.env.GH_REPOSITORY_DISPATCH_TOKEN;
    } else {
      process.env.GH_REPOSITORY_DISPATCH_TOKEN = originalGhRepositoryDispatchToken;
    }
  }
});

test('payload validation reports missing required fields', () => {
  const errors = validateOnboardOrgPayload({
    name: '',
    headcount: -1,
    businessregion: 'north',
    data: {},
  });

  assert.deepEqual(errors, [
    'name must be a non-empty string',
    'headcount must be a non-negative integer',
    'businessregion must be a number',
    'businesstype must be a number',
    'data.owner must be a non-empty string',
    'data.ownerphone must be a number or string',
  ]);
});

test('maps organization input to contractedorg row with 13 digit number', () => {
  const before = Date.now();
  const row = mapOrganizationToContractedOrg({
    name: 'demo',
    headcount: 4,
    businessregion: 1,
    businesstype: 2,
    data: {
      owner: 'name',
      ownerphone: 9875352512,
    },
  });
  const after = Date.now();

  assert.equal(row.name, 'demo');
  assert.equal(row.usercount, 4);
  assert.equal(row.businessregion, 1);
  assert.equal(row.businesstype, 2);
  assert.equal(row.status, true);
  assert.deepEqual(row.data, {
    owner: 'name',
    ownerphone: 9875352512,
  });
  assert.equal(Number.isInteger(row.number), true);
  assert.equal(String(row.number).length, 13);
  assert.equal(row.number >= before, true);
  assert.equal(row.number <= after, true);
});
