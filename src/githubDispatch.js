const DEFAULT_REPOSITORY = 'javiyoconsulting-dotcom/maachwala-backoffice';
const DEFAULT_EVENT_TYPE = 'apply-postgresql-ddl';

function getGithubDispatchConfig() {
  const token = process.env.GH_DISPATCH_TOKEN
    || process.env.GITHUB_DISPATCH_TOKEN
    || process.env.GH_REPOSITORY_DISPATCH_TOKEN;

  return {
    repository: process.env.GITHUB_DISPATCH_REPOSITORY || DEFAULT_REPOSITORY,
    eventType: process.env.GITHUB_DISPATCH_EVENT_TYPE || DEFAULT_EVENT_TYPE,
    token,
    tokenEnv: process.env.GH_DISPATCH_TOKEN
      ? 'GH_DISPATCH_TOKEN'
      : process.env.GITHUB_DISPATCH_TOKEN
        ? 'GITHUB_DISPATCH_TOKEN'
        : process.env.GH_REPOSITORY_DISPATCH_TOKEN
          ? 'GH_REPOSITORY_DISPATCH_TOKEN'
          : undefined,
  };
}

async function triggerGithubDispatch(payload, options = {}) {
  const config = {
    ...getGithubDispatchConfig(),
    ...options,
  };

  if (!config.token) {
    throw Object.assign(new Error('GitHub dispatch token is not configured'), {
      statusCode: 500,
      details: {
        expectedEnvVars: ['GH_DISPATCH_TOKEN', 'GITHUB_DISPATCH_TOKEN', 'GH_REPOSITORY_DISPATCH_TOKEN'],
        hasGhDispatchToken: Boolean(process.env.GH_DISPATCH_TOKEN),
        hasGithubDispatchToken: Boolean(process.env.GITHUB_DISPATCH_TOKEN),
        hasGhRepositoryDispatchToken: Boolean(process.env.GH_REPOSITORY_DISPATCH_TOKEN),
      },
    });
  }

  const response = await fetch(`https://api.github.com/repos/${config.repository}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      event_type: config.eventType,
      client_payload: payload,
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw Object.assign(
      new Error(`GitHub repository_dispatch failed with status ${response.status}`),
      {
        statusCode: 502,
        details: responseBody,
      },
    );
  }
}

module.exports = {
  getGithubDispatchConfig,
  triggerGithubDispatch,
};
