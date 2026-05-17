const GITHUB_API = "https://api.github.com";
const REPO_OWNER = process.env.PROJECTS_REPO_OWNER || "viirpuurikberg-cmyk";
const REPO_NAME = process.env.PROJECTS_REPO_NAME || "uus";
const PROJECTS_DIR = process.env.PROJECTS_STORAGE_DIR || "project-data";

module.exports = async function handler(req, res) {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      res.status(500).send("Missing GITHUB_TOKEN");
      return;
    }

    if (req.method === "GET") {
      const rows = await listProjects(token);
      res.status(200).json(rows);
      return;
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const site = body?.site;
      const projectId = normalizeProjectId(site?.id);
      if (!projectId || !site) {
        res.status(400).send("Missing site.id");
        return;
      }

      const path = `${PROJECTS_DIR}/${projectId}.json`;
      const existing = await getFile(token, path, { allowMissing: true });
      const content = Buffer.from(JSON.stringify({
        updatedAt: new Date().toISOString(),
        data: site
      }, null, 2)).toString("base64");

      const response = await githubFetch(token, `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `Update project data for ${projectId}`,
          content,
          sha: existing?.sha
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      res.status(200).json({ ok: true, id: projectId });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).send("Method not allowed");
  } catch (error) {
    const message = String(error?.message || error || "Unknown error");
    res.status(500).send(message);
  }
};

async function listProjects(token) {
  const directory = await githubFetch(token, `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${PROJECTS_DIR}`);
  if (directory.status === 404) return [];
  if (!directory.ok) {
    throw new Error(await directory.text());
  }

  const items = await directory.json();
  const rows = [];
  for (const item of items) {
    if (!item?.download_url || item.type !== "file" || !item.name.endsWith(".json")) continue;
    const response = await fetch(item.download_url, {
      headers: { "User-Agent": "uus-project-storage" }
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const parsed = JSON.parse(await response.text());
    if (parsed?.data?.id) rows.push(parsed);
  }
  return rows;
}

async function getFile(token, path, { allowMissing }) {
  const response = await githubFetch(token, `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`);
  if (response.status === 404 && allowMissing) return null;
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizeProjectId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "");
}

function githubFetch(token, path, options = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "uus-project-storage",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };

  return fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers
  });
}
