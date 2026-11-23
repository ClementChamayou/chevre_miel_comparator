// =====================================================================
//  Réglages du Guide Chèvre-Miel — c'est le SEUL fichier à modifier.
//  Tant que SUPABASE_URL contient « XXXX », l'app tourne en mode démo
//  (données stockées dans le navigateur uniquement).
// =====================================================================

export const CONFIG = {
  // Supabase > Project Settings > API (ou bouton « Connect »)
  SUPABASE_URL: 'https://XXXX.supabase.co',
  // Clé « publishable » (sb_publishable_…) ou l'ancienne clé « anon ».
  // Elle est faite pour être publique : la sécurité vient du code secret côté base.
  SUPABASE_KEY: 'XXXX',

  // Prénom affiché dans le titre (« Le Guide Chèvre-Miel de … »). Laisser '' pour aucun.
  PRENOM: '',

  // Vue de la carte au premier lancement, avant toute pizza notée.
  CARTE_DEPART: { lat: 46.6, lon: 2.4, zoom: 6 },
};
