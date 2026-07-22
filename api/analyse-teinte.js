// ============================================================================
//  Mon Bandô — /api/analyse-teinte
//  Fonction serverless Vercel : reçoit la photo d'une mèche de cheveux,
//  interroge l'API Anthropic (clé cachée côté serveur), et renvoie la
//  catégorie de teinte + la nuance affinée.
//
//  La clé Anthropic n'est JAMAIS dans le code : elle est lue depuis la
//  variable d'environnement ANTHROPIC_API_KEY (réglages Vercel).
//  Même modèle de sécurité que /api/airtable.
// ============================================================================

// Les 8 catégories de teinte Mon Bandô (référentiel figé).
const CATEGORIES = [
  "Noir",
  "Brun foncé",
  "Brun",
  "Châtain",
  "Châtain clair",
  "Blond foncé",
  "Blond",
  "Roux / divers",
];

const PROMPT = `Tu es l'assistant de tri des dons de cheveux de l'atelier Mon Bandô.
On te montre la photo d'une mèche de cheveux (un don reçu).

Ta tâche : déterminer teinte, longueur et texture de cette mèche.

1. TEINTE — Choisis UNE catégorie parmi ces 8, exactement telle qu'écrite :
Noir, Brun foncé, Brun, Châtain, Châtain clair, Blond foncé, Blond, Roux / divers.

2. NUANCE — Donne la nuance affinée dans le système coloriste (niveau.reflet),
par ex. "Châtain chaud 5.3", "Blond cendré 7.1", "Noir 1.0", "Brun froid 4.1".

3. LONGUEUR — Estime la longueur de la mèche en centimètres. Une règle ou un
mètre est souvent posé à côté de la mèche : SERS-T'EN comme repère d'échelle
pour mesurer précisément. Si aucun repère d'échelle n'est visible, renvoie 0
pour la longueur et signale-le dans la remarque.

4. TEXTURE — Choisis UNE texture parmi : Lisse, Ondulé, Bouclé, Crépu.

5. Estime ta confiance globale de 0 à 100.

6. Ajoute une remarque courte SI un point mérite l'œil humain (mèche
décolorée, méchée, reflet ambigu, pas de règle pour la longueur, photo
sombre…). Sinon chaîne vide.

Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour, sans
balises Markdown, de la forme :
{"categorie":"...","nuance":"...","longueur":32,"texture":"...","confiance":88,"remarque":"..."}`;

export default async function handler(req, res) {
  // CORS — l'app et l'API sont sur le même domaine Vercel, mais on reste souple.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Méthode non autorisée" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return res.status(500).json({
      error: "Clé API absente",
      detail: "Ajoutez ANTHROPIC_API_KEY dans les variables d'environnement Vercel.",
    });

  try {
    // Le corps peut arriver déjà parsé (Vercel) ou en string.
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    let { imageBase64, mediaType } = body;

    if (!imageBase64)
      return res.status(400).json({ error: "Photo manquante (imageBase64)" });

    // Si on a reçu un data-URL complet, on retire le préfixe.
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(imageBase64);
    if (m) {
      mediaType = mediaType || m[1];
      imageBase64 = m[2];
    }
    mediaType = mediaType || "image/jpeg";

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const t = await anthropicRes.text();
      return res.status(502).json({ error: "Erreur API Anthropic", status: anthropicRes.status, detail: t.slice(0, 500) });
    }

    const data = await anthropicRes.json();
    const raw = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // On isole le JSON même si le modèle ajoute quoi que ce soit autour.
    let parsed;
    try {
      const clean = raw.replace(/```json|```/g, "").trim();
      const s = clean.indexOf("{");
      const e = clean.lastIndexOf("}");
      parsed = JSON.parse(s >= 0 && e >= 0 ? clean.slice(s, e + 1) : clean);
    } catch {
      return res.status(200).json({ categorie: "", nuance: "", confiance: 0, remarque: "Réponse IA illisible — vérifiez à l'œil.", _raw: raw.slice(0, 300) });
    }

    // On force la catégorie dans le référentiel des 8 (sécurité).
    if (!CATEGORIES.includes(parsed.categorie)) {
      const found = CATEGORIES.find((c) => (parsed.categorie || "").toLowerCase().includes(c.toLowerCase().split(" ")[0]));
      parsed.categorie = found || "";
    }

    // On force la texture dans la liste connue.
    const TEXTURES = ["Lisse", "Ondulé", "Bouclé", "Crépu"];
    if (!TEXTURES.includes(parsed.texture)) {
      const ft = TEXTURES.find((t) => (parsed.texture || "").toLowerCase().startsWith(t.toLowerCase().slice(0, 4)));
      parsed.texture = ft || "";
    }

    return res.status(200).json({
      categorie: parsed.categorie || "",
      nuance: parsed.nuance || "",
      longueur: Number(parsed.longueur) || 0,
      texture: parsed.texture || "",
      confiance: Number(parsed.confiance) || 0,
      remarque: parsed.remarque || "",
    });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur", detail: String(err).slice(0, 300) });
  }
}
