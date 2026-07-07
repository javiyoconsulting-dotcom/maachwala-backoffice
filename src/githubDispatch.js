const DEFAULT_REPOSITORY = 'javiyoconsulting-dotcom/maachwala-backoffice';
const DEFAULT_EVENT_TYPE = 'apply-postgresql-ddl';

function getGithubDispatchConfig() {
  return {
    repository: process.env.GITHUB_DISPATCH_REPOSITORY || DEFAULT_REPOSITORY,
    eventType: process.env.GITHUB_DISPATCH_EVENT_TYPE || DEFAULT_EVENT_TYPE,
    token: process.env.GITHUB_DISPATCH_TOKEN,
  };
}

async function triggerGithubDispatch(payload, options = {}) {
  const config = {
    ...getGithubDispatchConfig(),
    ...options,
  };

  if (!config.token) {
    throw Object.assign(new Error('GITHUB_DISPATCH_TOKEN is not configured'), { statusCode: 500 });
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
  triggerGithubDispatch,
};
