import "@std/dotenv/load";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import {
  createOAuthAppAuth,
  createOAuthUserAuth,
} from "@octokit/auth-oauth-app";

async function createChallengeRepo(username: string) {
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: Number(Deno.env.get("GITHUB_APP_ID")!),
      clientId: Deno.env.get("GITHUB_CLIENT_ID")!,
      clientSecret: Deno.env.get("GITHUB_CLIENT_SECRET")!,
      privateKey: Deno.env.get("GITHUB_APP_PRIVATE_KEY")!,
    },
  });

  const install = await appOctokit.rest.apps.getOrgInstallation({
    org: "plfanzen-challenges",
  });

  const accessTokenResponse =
    await appOctokit.rest.apps.createInstallationAccessToken({
      installation_id: install.data.id,
      permissions: {
        contents: "read",
        administration: "write",
      },
    });

  const octokit = new Octokit({
    auth: accessTokenResponse.data.token,
  });

  const existingRepo = await octokit.rest.repos
    .get({
      owner: "plfanzen-challenges",
      repo: `challenge-${username}`,
    })
    .catch(() => null);

  if (!existingRepo || existingRepo.status !== 200) {
    await octokit.rest.repos.createUsingTemplate({
      template_owner: "plfanzen-challenges",
      template_repo: "challenge-template",
      owner: "plfanzen-challenges",
      name: `challenge-repo-${username}`,
      private: true,
    });
  } else {
    const existingInvite = await octokit.rest.repos.listInvitations({
      owner: "plfanzen-challenges",
      repo: `challenge-repo-${username}`,
    });

    const alreadyInvited = existingInvite.data.find(
      (inv) => inv.invitee?.login === username,
    );

    if (alreadyInvited) {
      const dest = alreadyInvited.html_url;
      return Response.redirect(dest, 302);
    } else {
      const perms = await octokit.rest.repos
        .getCollaboratorPermissionLevel({
          owner: "plfanzen-challenges",
          repo: `challenge-repo-${username}`,
          username: username,
        })
        .catch(() => null);

      if (perms && perms.data.permission !== "none") {
        return new Response(`User ${username} is already a collaborator.`, {
          status: 400,
        });
      }
    }
  }

  const invite = await octokit.rest.repos.addCollaborator({
    owner: "plfanzen-challenges",
    repo: `challenge-repo-${username}`,
    username: username,
    permission: "triage",
  });
  console.log(invite);

  const dest = invite.data.html_url;

  return Response.redirect(dest, 302);
}

function requestGitHubOAuth() {
  const clientId = Deno.env.get("GITHUB_CLIENT_ID");
  const redirectUri = "http://gh-instancer.plfanzen.garden/oauth/callback";

  const params = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri,
    scope: "read:user",
  });
  const githubOAuthUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;

  return Response.redirect(githubOAuthUrl, 302);
}

async function handleOAuthCallback(code: string) {
  const appAuth = createOAuthAppAuth({
    clientType: "github-app",
    clientId: Deno.env.get("GITHUB_CLIENT_ID")!,
    clientSecret: Deno.env.get("GITHUB_CLIENT_SECRET")!,
  });

  const userAuth = await appAuth({
    type: "oauth-user",
    code,
    factory: createOAuthUserAuth,
  });

  const authentication = await userAuth();

  const octokit = new Octokit({
    auth: authentication.token,
  });

  const { data: user } = await octokit.rest.users.getAuthenticated();

  const username = user.login;

  await userAuth({
    type: "deleteAuthorization",
  });

  return createChallengeRepo(username);
}

Deno.serve((req) => {
  const url = new URL(req.url);

  if (url.pathname === "/oauth/callback") {
    const code = url.searchParams.get("code");
    if (!code) {
      return new Response("Missing code parameter", { status: 400 });
    }
    return handleOAuthCallback(code);
  } else {
    return requestGitHubOAuth();
  }
});
