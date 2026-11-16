// ============================================================
// SITE-WIDE DETAILS (single source of truth)
// Used by the header, footer and contact page so contact
// details and social links never drift apart.
// ============================================================

export const SITE = {
  name: "Silora Academy",
  logo: "https://res.cloudinary.com/dnmvriw3e/image/upload/v1770561256/Logo_qe3dyz.jpg",
  email: "info@siloraacademy.com",
  phone: "+91 9606840892",
  phoneHref: "tel:+919606840892",
  website: "www.siloraacademy.com",
  websiteHref: "https://www.siloraacademy.com",
};

export const WHATSAPP_URL =
  "https://wa.me/+919606840892?text=Hello%20Silora%20Academy!%20I%20would%20like%20to%20learn%20more%20about%20your%20tutoring%20services.";

export const SOCIAL_LINKS = {
  facebook: "https://www.facebook.com/share/1CFwE2urXa",
  instagram: "https://www.instagram.com/siloraacademy",
  whatsapp: WHATSAPP_URL,
  telegram: "https://t.me/siloraacademy",
};

export const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About" },
  { to: "/services", label: "Services" },
  { to: "/contact", label: "Contact" },
];

export const BOARDS = ["CBSE", "ICSE", "IGCSE", "IB", "Cambridge", "A-Level", "State Board"];
