// =====================================================================
// Service sécurisé Mon Bandô — fait le lien entre l'application et Airtable.
// La clé Airtable est lue depuis une variable d'environnement (AIRTABLE_TOKEN)
// configurée dans Vercel : elle n'est JAMAIS dans l'application ni exposée
// au navigateur. Ce fichier ne se modifie pas.
// =====================================================================

export default async function handler(req, res) {
  // CORS : autorise l'app à appeler ce service
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const TOKEN = process.env.AIRTABLE_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: "AIRTABLE_TOKEN manquant (à configurer dans Vercel)" });

  try {
    const { action, baseId, tableId, recordId, fields, fieldName, file, contentType, filename } = req.body || {};

    // --- Upload d'une pièce jointe (photo) directement dans Airtable (max 5 Mo) ---
    if (action === "uploadAttachment") {
      const up = "https://content.airtable.com/v0/" + baseId + "/" + recordId + "/" + encodeURIComponent(fieldName) + "/uploadAttachment";
      const r = await fetch(up, {
        method: "POST",
        headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ contentType, file, filename })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.status(200).json(data);
    }

    const base = "https://api.airtable.com/v0/" + baseId + "/" + encodeURIComponent(tableId);
    const auth = { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" };
    let url = base, method = "GET", body = null;

    if (action === "listRecords") {
      method = "GET";
      url = base + "?pageSize=100";
    } else if (action === "createRecord") {
      method = "POST";
      body = JSON.stringify({ fields, typecast: true });
    } else if (action === "updateRecord") {
      method = "PATCH";
      url = base + "/" + recordId;
      body = JSON.stringify({ fields, typecast: true });
    } else {
      return res.status(400).json({ error: "Action inconnue : " + action });
    }

    const r = await fetch(url, { method, headers: auth, body });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
