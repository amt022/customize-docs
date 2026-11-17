// Creative Studio: festival greetings and party / family-event cards.
// Same drawing helpers and on-card editing as the wedding designs (cards.ts).
import {
  SCRIPT, SERIF, THEMES, background, divider, drawQr, edited, fit, formatDate, formatTime, mandala, petal,
  emblem, photoCircle, place, quiet, say, theme, wrap, type Frame, type Item, type Lang, type Overrides, type Pic, type Theme,
} from "./cards";

// ---------------------------------------------------------------- shared

/** Small deterministic random so a design looks the same every time it is drawn. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2, rr = i % 2 ? r * inner : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** A moon: circle r at (x, y) minus a circle ir offset by (ox, oy). Clipped, so the card behind stays intact. */
function crescent(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ox: number, oy: number, ir: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - r * 2, y - r * 2, r * 4, r * 4);
  ctx.arc(x + ox, y + oy, ir, 0, Math.PI * 2, true);
  ctx.clip("evenodd");
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function diya(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: Theme) {
  glow(ctx, x, y - s * 0.9, s * 1.6, "rgba(255,200,80,0.55)");
  // flame
  ctx.beginPath(); ctx.moveTo(x, y - s * 1.35);
  ctx.quadraticCurveTo(x + s * 0.32, y - s * 0.75, x, y - s * 0.45);
  ctx.quadraticCurveTo(x - s * 0.32, y - s * 0.75, x, y - s * 1.35);
  ctx.fillStyle = "#ffd75e"; ctx.fill();
  ctx.beginPath(); ctx.ellipse(x, y - s * 0.62, s * 0.08, s * 0.16, 0, 0, Math.PI * 2); ctx.fillStyle = "#fff6d0"; ctx.fill();
  // lamp bowl
  ctx.beginPath(); ctx.moveTo(x - s, y - s * 0.4); ctx.quadraticCurveTo(x, y + s * 0.55, x + s, y - s * 0.4);
  ctx.quadraticCurveTo(x + s * 0.55, y - s * 0.25, x + s * 0.1, y - s * 0.45); ctx.lineTo(x - s * 0.1, y - s * 0.45);
  ctx.quadraticCurveTo(x - s * 0.55, y - s * 0.25, x - s, y - s * 0.4);
  ctx.fillStyle = t.accent; ctx.fill();
  ctx.strokeStyle = t.soft; ctx.lineWidth = s * 0.06;
  ctx.beginPath(); ctx.moveTo(x - s * 0.7, y - s * 0.15); ctx.quadraticCurveTo(x, y + s * 0.2, x + s * 0.7, y - s * 0.15); ctx.stroke();
}

// ---------------------------------------------------------------- festival greetings

export type FestivalId = "diwali" | "holi" | "navratri" | "rakhi" | "eid" | "christmas" | "newyear" | "independence"
  | "republic" | "ganesh" | "janmashtami" | "dussehra" | "shivratri" | "chhath" | "sankranti" | "lohri" | "pongal"
  | "karwachauth" | "bhaidooj" | "onam" | "baisakhi" | "teachers";

export interface Greeting {
  festival: FestivalId;
  from: string;     // "Sharma family"
  message: string;  // empty = the festival's own message
  lang: Lang;
  wide?: boolean; // 16:9 banner instead of the square post
}

interface Festival { en: string; hi: string; msgEn: string; msgHi: string; theme: Theme; petals: string[] }

const T = (id: string, bg: [string, string], ink: string, accent: string, soft: string, motif: Theme["motif"]): Theme => ({ id, name: id, bg, ink, accent, soft, motif });

export const FESTIVALS: Record<FestivalId, Festival> = {
  diwali: { en: "Happy Diwali", hi: "शुभ दीपावली", msgEn: "May the light of the diyas fill your home with joy, health and prosperity.", msgHi: "दीपों की रोशनी आपके घर को सुख, समृद्धि और खुशियों से भर दे।", theme: T("diwali", ["#3b0f5c", "#12021f"], "#fff1d6", "#f5b52e", "#ff8a3d", "mandala"), petals: ["#f5b52e", "#ff8a3d", "#ffd75e"] },
  holi: { en: "Happy Holi", hi: "होली की शुभकामनाएँ", msgEn: "May your life be as colourful as the colours of Holi.", msgHi: "रंगों का यह त्योहार आपके जीवन को खुशियों के रंगों से भर दे।", theme: T("holi", ["#ffffff", "#fdf1f7"], "#3a2150", "#e0318c", "#2bb3e8", "floral"), petals: ["#e0318c", "#2bb3e8", "#ffd23f", "#3ecf6e", "#8e44ec"] },
  navratri: { en: "Happy Navratri", hi: "शुभ नवरात्रि", msgEn: "May Maa Durga bless you with strength, wisdom and happiness.", msgHi: "माँ दुर्गा आपको शक्ति, बुद्धि और सुख-समृद्धि का आशीर्वाद दें।", theme: T("navratri", ["#d7261e", "#7e0b0b"], "#fff3d6", "#ffd13b", "#ff9b2f", "mandala"), petals: ["#ffd13b", "#ff9b2f", "#ffffff"] },
  rakhi: { en: "Happy Raksha Bandhan", hi: "रक्षाबंधन की शुभकामनाएँ", msgEn: "A thread of love, a promise of care. Happy Rakhi to my dear sibling.", msgHi: "प्यार का धागा, रक्षा का वचन। रक्षाबंधन की हार्दिक शुभकामनाएँ।", theme: T("rakhi", ["#fff5e1", "#ffd9a8"], "#5a1f00", "#d4471f", "#f39c12", "floral"), petals: ["#d4471f", "#f39c12", "#e84393"] },
  eid: { en: "Eid Mubarak", hi: "ईद मुबारक", msgEn: "May this Eid bring peace, happiness and blessings to you and your family.", msgHi: "यह ईद आपके और आपके परिवार के लिए अमन, खुशियाँ और बरकत लेकर आए।", theme: T("eid", ["#0d4a3a", "#03211a"], "#f1f7ea", "#e8c76a", "#7fd1b3", "line"), petals: ["#e8c76a", "#ffffff"] },
  christmas: { en: "Merry Christmas", hi: "क्रिसमस की शुभकामनाएँ", msgEn: "Wishing you peace, joy and love this Christmas and always.", msgHi: "क्रिसमस आपके जीवन में शांति, आनंद और प्रेम लाए।", theme: T("christmas", ["#a3141c", "#4d0509"], "#fff7ef", "#f2d27a", "#3fa66b", "line"), petals: ["#ffffff", "#f2d27a"] },
  newyear: { en: "Happy New Year", hi: "नववर्ष की शुभकामनाएँ", msgEn: "May the new year bring you new hopes, new dreams and new success.", msgHi: "नया साल आपके लिए नई उम्मीदें, नए सपने और नई सफलताएँ लाए।", theme: T("newyear", ["#14213d", "#03060f"], "#f5f7ff", "#ffcf4a", "#6ab7ff", "line"), petals: ["#ffcf4a", "#6ab7ff", "#ff6b9a"] },
  independence: { en: "Happy Independence Day", hi: "स्वतंत्रता दिवस की शुभकामनाएँ", msgEn: "Proud to be Indian. Let us honour the freedom our heroes gave us.", msgHi: "गर्व है कि हम भारतीय हैं। आइए अपने वीरों के दिए स्वतंत्रता का सम्मान करें।", theme: T("independence", ["#ffffff", "#f3f6f9"], "#0b2a5b", "#ff7a1a", "#138808", "line"), petals: ["#ff9933", "#ffffff", "#138808"] },
  republic: { en: "Happy Republic Day", hi: "गणतंत्र दिवस की शुभकामनाएँ", msgEn: "Let us celebrate the Constitution that unites us all. Jai Hind!", msgHi: "आइए उस संविधान का उत्सव मनाएँ जो हम सबको एक करता है। जय हिंद!", theme: T("republic", ["#fffaf2", "#eef4ff"], "#0b2a5b", "#ff7a1a", "#138808", "line"), petals: ["#ff9933", "#ffffff", "#138808"] },
  ganesh: { en: "Happy Ganesh Chaturthi", hi: "गणेश चतुर्थी की शुभकामनाएँ", msgEn: "May Lord Ganesha remove every obstacle and bless you with wisdom and success.", msgHi: "विघ्नहर्ता श्री गणेश आपके सारे विघ्न दूर करें और बुद्धि व सफलता का आशीर्वाद दें।", theme: T("ganesh", ["#ff8c1a", "#c2410c"], "#fff7e6", "#fff0a8", "#ffd36b", "mandala"), petals: ["#fff0a8", "#e11d48", "#ffd36b"] },
  janmashtami: { en: "Happy Janmashtami", hi: "जन्माष्टमी की शुभकामनाएँ", msgEn: "May Lord Krishna fill your life with love, joy and the music of his flute.", msgHi: "श्रीकृष्ण आपके जीवन को प्रेम, आनंद और बाँसुरी की मधुर धुन से भर दें।", theme: T("janmashtami", ["#0f3b73", "#071a36"], "#eef6ff", "#f4c542", "#3cc0b0", "mandala"), petals: ["#f4c542", "#3cc0b0", "#ffffff"] },
  dussehra: { en: "Happy Dussehra", hi: "विजयादशमी की शुभकामनाएँ", msgEn: "May good always win over evil in your life. Happy Vijayadashami.", msgHi: "आपके जीवन में सदा अच्छाई की बुराई पर जीत हो। विजयादशमी की शुभकामनाएँ।", theme: T("dussehra", ["#8a1c00", "#3d0a00"], "#fff1d6", "#ffb703", "#fb8500", "mandala"), petals: ["#ffb703", "#fb8500", "#ffe08a"] },
  shivratri: { en: "Happy Maha Shivratri", hi: "महाशिवरात्रि की शुभकामनाएँ", msgEn: "May Lord Shiva bless you with peace, strength and good health. Har Har Mahadev!", msgHi: "भगवान शिव आपको शांति, शक्ति और अच्छा स्वास्थ्य दें। हर हर महादेव!", theme: T("shivratri", ["#1d2a4d", "#0a1022"], "#eef2ff", "#9fc3ff", "#c9d6ff", "line"), petals: ["#9fc3ff", "#ffffff"] },
  chhath: { en: "Happy Chhath Puja", hi: "छठ पूजा की शुभकामनाएँ", msgEn: "May Chhathi Maiya and the Sun God bless your family with health and happiness.", msgHi: "छठी मैया और सूर्य देव आपके परिवार को सुख और आरोग्य का आशीर्वाद दें।", theme: T("chhath", ["#ffb347", "#e8590c"], "#3d1300", "#9a2a00", "#fff3c4", "floral"), petals: ["#fff3c4", "#ffcf4a", "#e8590c"] },
  sankranti: { en: "Happy Makar Sankranti", hi: "मकर संक्रांति की शुभकामनाएँ", msgEn: "May your life soar high like kites in the clear winter sky.", msgHi: "आपकी ज़िंदगी साफ़ आसमान में पतंग की तरह ऊँची उड़ान भरे।", theme: T("sankranti", ["#e6f4ff", "#bfe0ff"], "#103a66", "#e8590c", "#2f9e44", "line"), petals: ["#e8590c", "#2f9e44", "#f59f00", "#d6336c"] },
  lohri: { en: "Happy Lohri", hi: "लोहड़ी की लख-लख बधाइयाँ", msgEn: "May the Lohri bonfire burn away sadness and bring warmth and joy.", msgHi: "लोहड़ी की आग सारे दुख जला दे और खुशियों की गर्माहट लाए।", theme: T("lohri", ["#2b0f05", "#120400"], "#fff1d6", "#ff9f1c", "#ffbf69", "line"), petals: ["#ff9f1c", "#ffbf69", "#ff4d00"] },
  pongal: { en: "Happy Pongal", hi: "पोंगल की शुभकामनाएँ", msgEn: "May this harvest festival overflow your home with prosperity, like the Pongal pot.", msgHi: "पोंगल के बर्तन की तरह आपका घर समृद्धि से भर जाए।", theme: T("pongal", ["#fff5d6", "#ffe08a"], "#4a2a00", "#c2410c", "#2f9e44", "floral"), petals: ["#c2410c", "#2f9e44", "#f59f00"] },
  karwachauth: { en: "Happy Karwa Chauth", hi: "करवा चौथ की शुभकामनाएँ", msgEn: "May the moon bless your bond with love, trust and a lifetime together.", msgHi: "चाँद आपके रिश्ते को प्रेम, विश्वास और जीवन भर के साथ का आशीर्वाद दे।", theme: T("karwachauth", ["#7a0d3a", "#33041a"], "#fff0f5", "#ffd27a", "#ff8fb1", "floral"), petals: ["#ffd27a", "#ff8fb1", "#ffffff"] },
  bhaidooj: { en: "Happy Bhai Dooj", hi: "भाई दूज की शुभकामनाएँ", msgEn: "A tilak of love and a prayer for my brother's long and happy life.", msgHi: "प्यार का तिलक और भाई की लंबी, खुशहाल ज़िंदगी की प्रार्थना।", theme: T("bhaidooj", ["#fff3e0", "#ffd8a8"], "#5a1f00", "#d9480f", "#f59f00", "floral"), petals: ["#d9480f", "#f59f00", "#e64980"] },
  onam: { en: "Happy Onam", hi: "ओणम की शुभकामनाएँ", msgEn: "May King Mahabali bless your home with happiness, health and plenty.", msgHi: "राजा महाबली आपके घर को सुख, स्वास्थ्य और समृद्धि का आशीर्वाद दें।", theme: T("onam", ["#fffdf2", "#f6efc9"], "#3b3000", "#c99a06", "#2f9e44", "floral"), petals: ["#f59f00", "#e8590c", "#ffd43b", "#ffffff"] },
  baisakhi: { en: "Happy Baisakhi", hi: "बैसाखी की लख-लख बधाइयाँ", msgEn: "May the golden harvest bring joy, health and prosperity to your home.", msgHi: "सुनहरी फ़सल आपके घर में खुशियाँ, सेहत और खुशहाली लाए।", theme: T("baisakhi", ["#ffe066", "#f59f00"], "#3d2300", "#b35900", "#2f9e44", "leaf"), petals: ["#b35900", "#2f9e44", "#fff3bf"] },
  teachers: { en: "Happy Teachers' Day", hi: "शिक्षक दिवस की शुभकामनाएँ", msgEn: "Thank you for lighting the way with knowledge, patience and care.", msgHi: "ज्ञान, धैर्य और स्नेह से राह दिखाने के लिए हृदय से धन्यवाद।", theme: T("teachers", ["#eef6ff", "#d0e6ff"], "#13305a", "#2f74c0", "#f59f00", "line"), petals: ["#2f74c0", "#f59f00", "#ffffff"] },
};

export const FESTIVAL_ORDER = Object.keys(FESTIVALS) as FestivalId[];

function festivalArt(ctx: CanvasRenderingContext2D, f: FestivalId, cx: number, cy: number, s: number, t: Theme) {
  const r = rng(f.length * 97 + 13);
  ctx.save();
  if (f === "diwali") {
    for (let i = 0; i < 5; i++) diya(ctx, cx + (i - 2) * s * 0.42, cy + Math.abs(i - 2) * -s * 0.04 + s * 0.12, s * 0.15, t);
    for (let i = 0; i < 14; i++) { ctx.fillStyle = t.accent; ctx.globalAlpha = 0.6 + r() * 0.4; star(ctx, cx + (r() - 0.5) * s * 2, cy - s * (0.15 + r() * 0.5), s * (0.015 + r() * 0.025), 4, 0.35); ctx.fill(); }
  } else if (f === "holi") {
    const cols = ["#e0318c", "#2bb3e8", "#ffd23f", "#3ecf6e", "#8e44ec", "#ff7a1a"];
    for (let i = 0; i < 9; i++) {
      const x = cx + (r() - 0.5) * s * 1.7, y = cy + (r() - 0.5) * s * 0.7, rad = s * (0.12 + r() * 0.16);
      ctx.fillStyle = cols[i % cols.length]; ctx.globalAlpha = 0.75;
      ctx.beginPath();
      for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2, rr = rad * (0.7 + r() * 0.5); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
      for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(x + (r() - 0.5) * rad * 3, y + (r() - 0.5) * rad * 3, rad * 0.08 * (1 + r()), 0, 7); ctx.fill(); }
    }
  } else if (f === "navratri") {
    mandala(ctx, cx, cy, s * 0.38, t);
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(cx + side * s * 0.62, cy); ctx.rotate(side * 0.5);
      ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.045; ctx.beginPath(); ctx.moveTo(0, -s * 0.36); ctx.lineTo(0, s * 0.36); ctx.stroke();
      ctx.strokeStyle = t.soft; ctx.lineWidth = s * 0.05; for (const yy of [-0.24, 0, 0.24]) { ctx.beginPath(); ctx.moveTo(0, s * yy - s * 0.02); ctx.lineTo(0, s * yy + s * 0.02); ctx.stroke(); }
      ctx.restore();
    }
  } else if (f === "rakhi") {
    ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.025;
    ctx.beginPath(); ctx.moveTo(cx - s, cy + s * 0.05); ctx.bezierCurveTo(cx - s * 0.5, cy - s * 0.1, cx + s * 0.5, cy - s * 0.1, cx + s, cy + s * 0.05); ctx.stroke();
    for (let i = 0; i < 12; i++) { ctx.save(); ctx.translate(cx, cy - s * 0.04); ctx.rotate((i / 12) * Math.PI * 2); petal(ctx, s * 0.32, s * 0.12); ctx.fillStyle = i % 2 ? t.soft : t.accent; ctx.fill(); ctx.restore(); }
    ctx.beginPath(); ctx.arc(cx, cy - s * 0.04, s * 0.11, 0, 7); ctx.fillStyle = "#ffd75e"; ctx.fill();
    star(ctx, cx, cy - s * 0.04, s * 0.07, 8, 0.5); ctx.fillStyle = t.accent; ctx.fill();
  } else if (f === "eid") {
    ctx.fillStyle = t.accent;
    crescent(ctx, cx, cy, s * 0.36, s * 0.15, -s * 0.08, s * 0.32);
    star(ctx, cx + s * 0.2, cy - s * 0.02, s * 0.09); ctx.fill();
    for (const side of [-1, 1]) { // lanterns
      const x = cx + side * s * 0.75;
      ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.01; ctx.beginPath(); ctx.moveTo(x, cy - s * 0.6); ctx.lineTo(x, cy - s * 0.25); ctx.stroke();
      glow(ctx, x, cy - s * 0.1, s * 0.22, "rgba(255,210,120,0.45)");
      ctx.fillStyle = t.accent; ctx.beginPath(); ctx.moveTo(x, cy - s * 0.28); ctx.lineTo(x + s * 0.1, cy - s * 0.14); ctx.lineTo(x + s * 0.08, cy + s * 0.04); ctx.lineTo(x - s * 0.08, cy + s * 0.04); ctx.lineTo(x - s * 0.1, cy - s * 0.14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff3c4"; ctx.fillRect(x - s * 0.04, cy - s * 0.15, s * 0.08, s * 0.14);
    }
  } else if (f === "christmas") {
    ctx.fillStyle = t.soft;
    for (let i = 0; i < 3; i++) { const w = s * (0.32 + i * 0.14), y0 = cy - s * 0.45 + i * s * 0.22; ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx + w, y0 + s * 0.38); ctx.lineTo(cx - w, y0 + s * 0.38); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = "#6b3b1f"; ctx.fillRect(cx - s * 0.06, cy + s * 0.37, s * 0.12, s * 0.12);
    ctx.fillStyle = t.accent; star(ctx, cx, cy - s * 0.5, s * 0.1); ctx.fill();
    const cols = [t.accent, "#ffffff", "#ff5a5a"];
    for (let i = 0; i < 14; i++) { ctx.fillStyle = cols[i % 3]; ctx.beginPath(); const yy = cy - s * 0.3 + r() * s * 0.62, half = (yy - (cy - s * 0.45)) * 0.75; ctx.arc(cx + (r() - 0.5) * half * 1.6, yy, s * 0.022, 0, 7); ctx.fill(); }
  } else if (f === "newyear") {
    const cols = ["#ffcf4a", "#6ab7ff", "#ff6b9a", "#7dffb0"];
    for (let b = 0; b < 4; b++) {
      const x = cx + (b - 1.5) * s * 0.55, y = cy - s * 0.1 + (b % 2) * s * 0.2, rad = s * (0.22 + r() * 0.1);
      ctx.strokeStyle = cols[b]; ctx.lineWidth = s * 0.012; ctx.lineCap = "round";
      for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * rad * 0.3, y + Math.sin(a) * rad * 0.3); ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); ctx.stroke(); }
      glow(ctx, x, y, rad * 0.5, "rgba(255,255,255,0.35)");
    }
  } else if (f === "ganesh") {
    emblem(ctx, "lotus", cx, cy + s * 0.08, s * 0.32, t);
    for (const [dx, dy] of [[-0.6, 0.18], [-0.48, 0.18], [-0.54, 0.06], [0.48, 0.18], [0.6, 0.18], [0.54, 0.06]]) {
      const x = cx + dx * s, y = cy + dy * s, r = s * 0.07;
      ctx.fillStyle = "#fff3d0"; ctx.beginPath(); ctx.moveTo(x, y - r * 1.2); ctx.quadraticCurveTo(x + r, y - r * 0.2, x + r * 0.8, y + r * 0.5); ctx.lineTo(x - r * 0.8, y + r * 0.5); ctx.quadraticCurveTo(x - r, y - r * 0.2, x, y - r * 1.2); ctx.fill();
      ctx.strokeStyle = "#e0a96d"; ctx.lineWidth = s * 0.004; for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(x, y - r * 1.1); ctx.lineTo(x + k * r * 0.6, y + r * 0.45); ctx.stroke(); }
    }
    ctx.fillStyle = t.accent; ctx.font = `700 ${s * 0.16}px ${SERIF}`; ctx.textAlign = "center"; ctx.fillText("श्री", cx, cy - s * 0.28);
  } else if (f === "janmashtami") {
    emblem(ctx, "peacock", cx + s * 0.35, cy - s * 0.05, s * 0.32, t);
    ctx.save(); ctx.translate(cx - s * 0.1, cy + s * 0.05); ctx.rotate(-0.35);
    ctx.fillStyle = "#c8873a"; ctx.fillRect(-s * 0.6, -s * 0.03, s * 1.0, s * 0.06);
    ctx.fillStyle = t.accent; for (const x of [-0.5, 0.25]) ctx.fillRect(x * s, -s * 0.035, s * 0.05, s * 0.07);
    ctx.fillStyle = "#5a3210"; for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(-s * 0.35 + k * s * 0.09, 0, s * 0.012, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  } else if (f === "dussehra") {
    ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.03; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx - s * 0.1, cy, s * 0.45, -Math.PI * 0.42, Math.PI * 0.42); ctx.stroke();
    ctx.lineWidth = s * 0.006; ctx.strokeStyle = t.soft;
    const a0 = -Math.PI * 0.42, a1 = Math.PI * 0.42;
    ctx.beginPath(); ctx.moveTo(cx - s * 0.1 + Math.cos(a0) * s * 0.45, cy + Math.sin(a0) * s * 0.45); ctx.lineTo(cx - s * 0.1 + Math.cos(a1) * s * 0.45, cy + Math.sin(a1) * s * 0.45); ctx.stroke();
    ctx.strokeStyle = t.ink; ctx.lineWidth = s * 0.012;
    ctx.beginPath(); ctx.moveTo(cx - s * 0.45, cy); ctx.lineTo(cx + s * 0.6, cy); ctx.stroke();
    ctx.fillStyle = t.accent; ctx.beginPath(); ctx.moveTo(cx + s * 0.7, cy); ctx.lineTo(cx + s * 0.56, cy - s * 0.05); ctx.lineTo(cx + s * 0.56, cy + s * 0.05); ctx.closePath(); ctx.fill();
    for (const k of [0, 1]) { ctx.fillStyle = t.soft; ctx.beginPath(); ctx.moveTo(cx - s * (0.45 - k * 0.05), cy); ctx.lineTo(cx - s * (0.52 - k * 0.05), cy - s * 0.05); ctx.lineTo(cx - s * (0.48 - k * 0.05), cy); ctx.lineTo(cx - s * (0.52 - k * 0.05), cy + s * 0.05); ctx.closePath(); ctx.fill(); }
  } else if (f === "shivratri") {
    ctx.fillStyle = t.accent; ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.025; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.5); ctx.lineTo(cx, cy - s * 0.35); ctx.stroke();
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.05); ctx.quadraticCurveTo(cx + sd * s * 0.25, cy - s * 0.05, cx + sd * s * 0.22, cy - s * 0.35); ctx.stroke(); }
    for (const x of [cx - s * 0.22, cx, cx + s * 0.22]) { ctx.beginPath(); ctx.moveTo(x, cy - s * 0.45); ctx.lineTo(x + s * 0.035, cy - s * 0.33); ctx.lineTo(x - s * 0.035, cy - s * 0.33); ctx.closePath(); ctx.fill(); }
    ctx.lineWidth = s * 0.012; ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.12, s * 0.06, s * 0.035, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#e6eeff"; crescent(ctx, cx + s * 0.55, cy - s * 0.3, s * 0.13, s * 0.06, -s * 0.03, s * 0.11);
  } else if (f === "chhath") {
    glow(ctx, cx, cy, s * 0.6, "rgba(255,240,180,0.7)");
    ctx.fillStyle = "#fff3c4"; ctx.beginPath(); ctx.arc(cx, cy + s * 0.05, s * 0.28, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = "#fff3c4"; ctx.lineWidth = s * 0.012;
    for (let k = 0; k <= 10; k++) { const a = Math.PI + (k / 10) * Math.PI; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * s * 0.34, cy + s * 0.05 + Math.sin(a) * s * 0.34); ctx.lineTo(cx + Math.cos(a) * s * 0.46, cy + s * 0.05 + Math.sin(a) * s * 0.46); ctx.stroke(); }
    ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.012;
    for (let r = 0; r < 4; r++) { ctx.beginPath(); for (let x = -0.9; x <= 0.9; x += 0.05) ctx.lineTo(cx + x * s, cy + s * (0.12 + r * 0.07) + Math.sin(x * 12 + r) * s * 0.012); ctx.stroke(); }
  } else if (f === "sankranti") {
    const kites: [number, number, number, string][] = [[-0.5, -0.1, 0.2, "#e8590c"], [0.05, -0.3, 0.24, "#2f9e44"], [0.55, 0.0, 0.18, "#d6336c"]];
    for (const [dx, dy, r, col] of kites) {
      const x = cx + dx * s, y = cy + dy * s, k = r * s;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - k); ctx.lineTo(x + k * 0.75, y); ctx.lineTo(x, y + k); ctx.lineTo(x - k * 0.75, y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = s * 0.004; ctx.beginPath(); ctx.moveTo(x, y - k); ctx.lineTo(x, y + k); ctx.moveTo(x - k * 0.75, y); ctx.lineTo(x + k * 0.75, y); ctx.stroke();
      ctx.strokeStyle = t.ink; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(x, y + k); ctx.bezierCurveTo(x + k * 0.3, y + k * 1.6, x - k * 0.4, y + k * 2, x + k * 0.1, y + k * 2.6); ctx.stroke(); ctx.globalAlpha = 1;
    }
  } else if (f === "lohri") {
    for (let k = 0; k < 3; k++) {
      const col = ["#ff4d00", "#ff9f1c", "#ffd166"][k], sc = 1 - k * 0.28;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx - s * 0.32 * sc, cy + s * 0.25);
      ctx.bezierCurveTo(cx - s * 0.35 * sc, cy - s * 0.05, cx - s * 0.1 * sc, cy - s * 0.1, cx - s * 0.05 * sc, cy - s * 0.45 * sc);
      ctx.bezierCurveTo(cx + s * 0.12 * sc, cy - s * 0.15, cx + s * 0.35 * sc, cy - s * 0.1, cx + s * 0.32 * sc, cy + s * 0.25); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = "#6b3b1f"; ctx.lineWidth = s * 0.04; ctx.lineCap = "round";
    for (const a of [-0.35, 0.35]) { ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * s * 0.4, cy + s * 0.3 + Math.sin(a) * s * 0.06); ctx.lineTo(cx + Math.cos(a) * s * 0.4, cy + s * 0.3 - Math.sin(a) * s * 0.06); ctx.stroke(); }
  } else if (f === "pongal") {
    ctx.strokeStyle = "#2f9e44"; ctx.lineWidth = s * 0.03;
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sd * s * 0.45, cy + s * 0.35); ctx.lineTo(cx + sd * s * 0.62, cy - s * 0.45); ctx.stroke(); ctx.fillStyle = "#2f9e44"; ctx.save(); ctx.translate(cx + sd * s * 0.62, cy - s * 0.45); ctx.rotate(sd * 0.5); petal(ctx, s * 0.2, s * 0.05); ctx.fill(); ctx.restore(); }
    ctx.fillStyle = "#b5651d"; ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.15, s * 0.3, s * 0.24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = t.accent; ctx.fillRect(cx - s * 0.3, cy + s * 0.08, s * 0.6, s * 0.04);
    ctx.fillStyle = "#fff8e7";
    for (const [dx, r] of [[-0.12, 0.1], [0.05, 0.13], [0.16, 0.09]]) { ctx.beginPath(); ctx.arc(cx + dx * s, cy - s * 0.08, r * s, Math.PI, 0); ctx.fill(); }
    ctx.fillRect(cx - s * 0.2, cy - s * 0.1, s * 0.4, s * 0.06);
  } else if (f === "karwachauth") {
    ctx.fillStyle = "#fff7d6"; glow(ctx, cx + s * 0.35, cy - s * 0.2, s * 0.35, "rgba(255,240,200,0.6)");
    ctx.beginPath(); ctx.arc(cx + s * 0.35, cy - s * 0.2, s * 0.18, 0, Math.PI * 2); ctx.fillStyle = "#fff7d6"; ctx.fill();
    ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.03; ctx.beginPath(); ctx.arc(cx - s * 0.2, cy + s * 0.05, s * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = s * 0.004;
    for (let k = -5; k <= 5; k++) { const d = k * s * 0.05, half = Math.sqrt(Math.max(0, (s * 0.28) ** 2 - d * d)); ctx.beginPath(); ctx.moveTo(cx - s * 0.2 + d, cy + s * 0.05 - half); ctx.lineTo(cx - s * 0.2 + d, cy + s * 0.05 + half); ctx.moveTo(cx - s * 0.2 - half, cy + s * 0.05 + d); ctx.lineTo(cx - s * 0.2 + half, cy + s * 0.05 + d); ctx.stroke(); }
  } else if (f === "bhaidooj") {
    ctx.fillStyle = t.accent; ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.15, s * 0.6, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = t.soft; ctx.lineWidth = s * 0.015; ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.12, s * 0.5, s * 0.11, 0, 0, Math.PI * 2); ctx.stroke();
    diya(ctx, cx, cy + s * 0.1, s * 0.13, t);
    ctx.fillStyle = "#d6336c"; ctx.beginPath(); ctx.arc(cx - s * 0.32, cy + s * 0.1, s * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff3bf"; for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.arc(cx + s * 0.28 + (k % 3) * s * 0.04, cy + s * 0.07 + Math.floor(k / 3) * s * 0.03, s * 0.016, 0, Math.PI * 2); ctx.fill(); }
  } else if (f === "onam") {
    const cols = ["#e8590c", "#ffd43b", "#f59f00", "#ffffff", "#2f9e44", "#d6336c"];
    for (let ring = 5; ring >= 0; ring--) {
      const n = 8 + ring * 4, r = s * (0.1 + ring * 0.08);
      for (let i = 0; i < n; i++) { ctx.save(); ctx.translate(cx, cy); ctx.rotate((i / n) * Math.PI * 2 + ring * 0.2); petal(ctx, r, s * 0.04 + ring * s * 0.005); ctx.fillStyle = cols[ring]; ctx.globalAlpha = 0.9; ctx.fill(); ctx.restore(); }
    }
    ctx.globalAlpha = 1; ctx.fillStyle = "#c2410c"; ctx.beginPath(); ctx.arc(cx, cy, s * 0.06, 0, Math.PI * 2); ctx.fill();
  } else if (f === "baisakhi") {
    for (let k = -4; k <= 4; k++) {
      const a = k * 0.12;
      ctx.save(); ctx.translate(cx, cy + s * 0.45); ctx.rotate(a);
      ctx.strokeStyle = "#8a5a00"; ctx.lineWidth = s * 0.008; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s * 0.6); ctx.stroke();
      ctx.fillStyle = "#d4a017"; for (let g = 0; g < 7; g++) for (const sd of [-1, 1]) { ctx.save(); ctx.translate(0, -s * 0.62 + g * s * 0.04); ctx.rotate(sd * 0.5); ctx.beginPath(); ctx.ellipse(0, 0, s * 0.012, s * 0.024, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
      ctx.restore();
    }
    ctx.fillStyle = "#c2410c"; ctx.fillRect(cx - s * 0.12, cy + s * 0.22, s * 0.24, s * 0.05);
  } else if (f === "teachers") {
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.01;
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.2); ctx.quadraticCurveTo(cx + sd * s * 0.25, cy - s * 0.3, cx + sd * s * 0.5, cy - s * 0.2); ctx.lineTo(cx + sd * s * 0.5, cy + s * 0.25); ctx.quadraticCurveTo(cx + sd * s * 0.25, cy + s * 0.15, cx, cy + s * 0.25); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.globalAlpha = 0.5; for (let k = 0; k < 5; k++) for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sd * s * 0.08, cy - s * 0.12 + k * s * 0.07); ctx.lineTo(cx + sd * s * 0.42, cy - s * 0.12 + k * s * 0.07); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(cx + s * 0.45, cy - s * 0.25); ctx.rotate(0.7); ctx.fillStyle = t.soft; ctx.fillRect(-s * 0.02, -s * 0.3, s * 0.04, s * 0.3); ctx.fillStyle = t.ink; ctx.beginPath(); ctx.moveTo(-s * 0.02, 0); ctx.lineTo(s * 0.02, 0); ctx.lineTo(0, s * 0.05); ctx.closePath(); ctx.fill(); ctx.restore();
  } else if (f === "independence" || f === "republic") {
    const bands: [string, number][] = [["#ff9933", -1], ["#ffffff", 0], ["#138808", 1]];
    for (const [col, k] of bands) {
      ctx.fillStyle = col; ctx.beginPath();
      const y0 = cy + k * s * 0.16;
      ctx.moveTo(cx - s, y0 - s * 0.08);
      for (let x = -1; x <= 1.001; x += 0.05) ctx.lineTo(cx + x * s, y0 - s * 0.08 + Math.sin(x * 4) * s * 0.05);
      for (let x = 1; x >= -1.001; x -= 0.05) ctx.lineTo(cx + x * s, y0 + s * 0.08 + Math.sin(x * 4) * s * 0.05);
      ctx.closePath(); ctx.fill();
      if (col === "#ffffff") { ctx.strokeStyle = "#dde3ea"; ctx.lineWidth = 1; ctx.stroke(); }
    }
    ctx.strokeStyle = "#000080"; ctx.lineWidth = s * 0.012;
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.07, 0, 7); ctx.stroke();
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * s * 0.07, cy + Math.sin(a) * s * 0.07); ctx.lineWidth = s * 0.004; ctx.stroke(); }
  }
  ctx.restore();
}

export function greetingSize(vertical: boolean, wide = false): [number, number] { return vertical ? [1080, 1920] : wide ? [1920, 1080] : [1080, 1080]; }

export function drawGreeting(ctx: CanvasRenderingContext2D, g: Greeting, photo: Pic | null, vertical: boolean, ov?: Overrides): Item[] {
  return edited(ov, () => {
    const wide = !!g.wide && !vertical;
    const [w, h] = greetingSize(vertical, wide);
    const f = FESTIVALS[g.festival], t = f.theme;
    const hi = g.lang !== "en", en = g.lang !== "hi";
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    background(ctx, w, h, t, wide ? "simple" : "ornate");
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    if (wide) { banner(); ctx.restore(); return; }
    const cx = w / 2, u = w / 1080, inner = w * 0.74;
    const V = vertical ? 1.25 : 1; // the tall size gets bigger art and type
    const fromY = h - h * (vertical ? 0.075 : 0.09);
    // measure first, then centre the block between the top border and the "from" line
    const top = h * (vertical ? 0.07 : 0.075), bottom = fromY - (g.from ? 70 : 20) * u;
    const scratch = document.createElement("canvas").getContext("2d")!;
    scratch.textAlign = "center";
    const height = quiet(() => body(scratch, 0, false));
    const start = top + Math.max(0, (bottom - top - height) / 2);
    const end = start + body(ctx, start, true);
    if (g.from) {
      ctx.fillStyle = t.accent;
      const line = `${en ? "Warm wishes from" : "शुभकामनाओं सहित,"} ${g.from}`;
      fit(ctx, line, (px) => `600 ${px}px ${SERIF}`, 36 * V * u, inner);
      say(ctx, "from", line, cx, Math.max(end + 40 * u, fromY));
    }
    ctx.restore();

    function body(ctx: CanvasRenderingContext2D, y0: number, paint: boolean): number {
      let y = y0;
      const artS = 260 * V * u;
      if (paint) festivalArt(ctx, g.festival, cx, y + artS * 0.6, artS, t);
      y += artS * 1.4;
      ctx.fillStyle = t.accent;
      if (hi) { fit(ctx, f.hi, (px) => `700 ${px}px ${SERIF}`, 92 * V * u, inner); say(ctx, "title.hi", f.hi, cx, y); y += 90 * V * u; }
      if (en) { ctx.fillStyle = hi ? t.soft : t.accent; fit(ctx, f.en, (px) => `${px}px ${SCRIPT}`, (hi ? 76 : 120) * V * u, inner); say(ctx, "title.en", f.en, cx, y); y += (hi ? 70 : 100) * V * u; }
      if (paint) divider(ctx, cx, y, inner * 0.6, t);
      y += 64 * u;
      if (photo) {
        const r = 105 * V * V * u;
        const b = place("photo", cx - r, y, r * 2, r * 2);
        if (paint && !b.hidden) photoCircle(ctx, photo, b.x + b.w / 2, b.y + b.h / 2, b.w / 2, t);
        y += r * 2 + 54 * u;
      }
      ctx.fillStyle = t.ink;
      const msgs = g.message ? [g.message] : [hi ? f.msgHi : "", en ? f.msgEn : ""].filter(Boolean);
      let n = 0;
      for (const m of msgs) {
        ctx.font = `${/[ऀ-ॿ]/.test(m) ? "" : "italic "}400 ${34 * V * u}px ${SERIF}`;
        for (const l of wrap(ctx, m, inner)) { say(ctx, `msg.${n++}`, l, cx, y); y += 46 * V * u; }
        y += 10 * u;
      }
      return y - y0;
    }

    /** 16:9 banner: big festival art on the left, greeting text centred on the right. */
    function banner() {
      const u = h / 1080, cx = w * 0.7, inner = w * 0.5;
      const glowR = h * 0.55;
      const gl = ctx.createRadialGradient(w * 0.24, h / 2, 0, w * 0.24, h / 2, glowR);
      gl.addColorStop(0, t.soft + "55"); gl.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gl; ctx.fillRect(0, 0, w * 0.6, h);
      festivalArt(ctx, g.festival, w * 0.24, h * 0.47, Math.min(h * 0.5, w * 0.2), t);
      const lines = (paint: boolean, k: number) => {
        let y = 0;
        const step = (n: number) => { y += n * k * u; };
        const c = paint ? ctx : document.createElement("canvas").getContext("2d")!;
        c.textAlign = "center";
        const at = (id: string, text: string) => { if (paint) say(c, id, text, cx, top + y); };
        if (hi) { c.fillStyle = t.accent; fit(c, f.hi, (px) => `700 ${px}px ${SERIF}`, 130 * k * u, inner); step(110); at("title.hi", f.hi); step(30); }
        if (en) {
          c.fillStyle = hi ? t.soft : t.accent;
          const px = fit(c, f.en, (n) => `${n}px ${SCRIPT}`, (hi ? 100 : 170) * k * u, inner);
          step(px / u / k * 0.8); at("title.en", f.en); step(30);
        }
        if (paint) divider(c, cx, top + y + 10 * k * u, inner * 0.5, t);
        step(80);
        c.fillStyle = t.ink;
        const msgs = g.message ? [g.message] : [hi ? f.msgHi : "", en ? f.msgEn : ""].filter(Boolean);
        let n = 0;
        for (const m of msgs) {
          c.font = `${/[ऀ-ॿ]/.test(m) ? "" : "italic "}400 ${40 * k * u}px ${SERIF}`;
          for (const l of wrap(c, m, inner)) { at(`msg.${n++}`, l); step(54); }
          step(10);
        }
        if (g.from) {
          step(30);
          c.fillStyle = t.accent;
          const line = `${en ? "Warm wishes from" : "शुभकामनाओं सहित,"} ${g.from}`;
          fit(c, line, (px) => `600 ${px}px ${SERIF}`, 42 * k * u, inner);
          at("from", line); step(20);
        }
        return y;
      };
      const avail = h * 0.8;
      let top = 0;
      const tall = quiet(() => lines(false, 1));
      const k = Math.min(1.45, avail / tall);
      top = (h - lines(false, k)) / 2 + 20 * u;
      if (photo) {
        const r = h * 0.11;
        const b = place("photo", w * 0.24 - r, h * 0.74, r * 2, r * 2);
        if (!b.hidden) photoCircle(ctx, photo, b.x + b.w / 2, b.y + b.h / 2, b.w / 2, t);
      }
      lines(true, k);
    }
  });
}

// ---------------------------------------------------------------- party / family events

export type OccasionId = "birthday" | "anniversary" | "grihapravesh" | "babyshower" | "naming"
  | "puja" | "mundan" | "upanayan" | "inauguration" | "retirement" | "sangeet" | "prayer";

export interface Party {
  occasion: OccasionId;
  name: string; nameHi: string;
  number: string; // age / years married
  host: string;
  date: string; time: string; venue: string; address: string;
  rsvp: string; qr: string;
  lang: Lang; theme: string; frame?: Frame;
}

interface Occasion { en: string; hi: string; inviteEn: string; inviteHi: string; numberLabel?: [string, string]; defaultTheme: string; nameLabel?: string }

export const OCCASIONS: Record<OccasionId, Occasion> = {
  birthday: { nameLabel: "Name", en: "Birthday Party", hi: "जन्मदिन समारोह", inviteEn: "You are invited to celebrate the birthday of", inviteHi: "के जन्मदिन के उत्सव में आप सादर आमंत्रित हैं", numberLabel: ["turns", "वाँ जन्मदिन"], defaultTheme: "blush" },
  anniversary: { nameLabel: "Couple's names", en: "Wedding Anniversary", hi: "विवाह वर्षगाँठ", inviteEn: "Please join us to celebrate the wedding anniversary of", inviteHi: "की विवाह वर्षगाँठ के अवसर पर आप सादर आमंत्रित हैं", numberLabel: ["years together", "वीं वर्षगाँठ"], defaultTheme: "ivory" },
  grihapravesh: { nameLabel: "Family name", en: "Griha Pravesh", hi: "गृह प्रवेश", inviteEn: "With the blessings of the Almighty, we invite you to the house-warming of", inviteHi: "ईश्वर की कृपा से हमारे नए घर के गृह प्रवेश में आप सादर आमंत्रित हैं", defaultTheme: "haldi" },
  babyshower: { nameLabel: "Mother-to-be", en: "Godh Bharai", hi: "गोद भराई", inviteEn: "Please join us for the baby shower of", inviteHi: "की गोद भराई रस्म में आप सपरिवार आमंत्रित हैं", defaultTheme: "blush" },
  naming: { nameLabel: "Baby's name", en: "Naming Ceremony", hi: "नामकरण संस्कार", inviteEn: "We invite you to bless our little one at the naming ceremony of", inviteHi: "के नामकरण संस्कार में आशीर्वाद देने हेतु आप सादर आमंत्रित हैं", defaultTheme: "peacock" },
  puja: { en: "Shri Satyanarayan Katha", hi: "श्री सत्यनारायण कथा", inviteEn: "With the blessings of the Almighty, you are invited to the puja and katha at the home of", inviteHi: "के निवास पर श्री सत्यनारायण कथा एवं पूजन में आप सपरिवार आमंत्रित हैं", defaultTheme: "saffron", nameLabel: "Family name" },
  mundan: { en: "Mundan Sanskar", hi: "मुंडन संस्कार", inviteEn: "Please bless our little one at the mundan ceremony of", inviteHi: "के मुंडन संस्कार में आशीर्वाद देने हेतु आप सादर आमंत्रित हैं", defaultTheme: "haldi", nameLabel: "Child's name" },
  upanayan: { en: "Upanayan Sanskar", hi: "यज्ञोपवीत संस्कार", inviteEn: "We request your presence and blessings at the sacred thread ceremony of", inviteHi: "के यज्ञोपवीत (जनेऊ) संस्कार में आपकी उपस्थिति प्रार्थनीय है", defaultTheme: "kumkum", nameLabel: "Name" },
  inauguration: { en: "Grand Opening", hi: "शुभ उद्घाटन", inviteEn: "You are cordially invited to the grand opening of", inviteHi: "के शुभ उद्घाटन समारोह में आप सादर आमंत्रित हैं", defaultTheme: "navy", nameLabel: "Shop or business name" },
  retirement: { en: "Retirement Celebration", hi: "सेवानिवृत्ति समारोह", inviteEn: "Please join us to celebrate the retirement of", inviteHi: "के सेवानिवृत्ति समारोह में आप सादर आमंत्रित हैं", numberLabel: ["years of service", "वर्ष की सेवा"], defaultTheme: "black", nameLabel: "Name" },
  sangeet: { en: "Sangeet Sandhya", hi: "संगीत संध्या", inviteEn: "Come sing and dance with us at the sangeet of", inviteHi: "की संगीत संध्या में नाचने-गाने आप सपरिवार आमंत्रित हैं", defaultTheme: "purple", nameLabel: "Couple's names" },
  prayer: { en: "Prayer Meeting", hi: "श्रद्धांजलि सभा", inviteEn: "With deep sorrow, we invite you to the prayer meeting in loving memory of", inviteHi: "की पुण्य स्मृति में आयोजित श्रद्धांजलि सभा में आप सादर आमंत्रित हैं", defaultTheme: "minimal", nameLabel: "In memory of" },
};

export const OCCASION_ORDER = Object.keys(OCCASIONS) as OccasionId[];

function occasionArt(ctx: CanvasRenderingContext2D, o: OccasionId, cx: number, cy: number, s: number, t: Theme) {
  ctx.save();
  if (o === "birthday") {
    const cols = [t.accent, t.soft, "#5ab0ff", "#ffcf4a", "#7bd88f"];
    [[-0.55, 0.05], [-0.25, -0.12], [0.05, 0.02], [0.33, -0.1], [0.6, 0.06]].forEach(([dx, dy], i) => {
      const x = cx + dx * s, y = cy + dy * s;
      ctx.strokeStyle = t.ink; ctx.globalAlpha = 0.4; ctx.lineWidth = s * 0.006;
      ctx.beginPath(); ctx.moveTo(x, y + s * 0.2); ctx.quadraticCurveTo(x + s * 0.04, y + s * 0.35, x - s * 0.02, y + s * 0.5); ctx.stroke();
      ctx.globalAlpha = 0.95; ctx.fillStyle = cols[i % cols.length];
      ctx.beginPath(); ctx.ellipse(x, y, s * 0.13, s * 0.17, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.ellipse(x - s * 0.04, y - s * 0.06, s * 0.03, s * 0.05, -0.5, 0, 7); ctx.fill();
    });
  } else if (o === "anniversary") {
    ctx.lineWidth = s * 0.035; ctx.strokeStyle = t.accent;
    ctx.beginPath(); ctx.arc(cx - s * 0.13, cy, s * 0.2, 0, 7); ctx.stroke();
    ctx.strokeStyle = t.soft; ctx.beginPath(); ctx.arc(cx + s * 0.13, cy, s * 0.2, 0, 7); ctx.stroke();
    ctx.fillStyle = "#e9f6ff"; star(ctx, cx - s * 0.13, cy - s * 0.21, s * 0.05, 4, 0.5); ctx.fill();
    for (const [dx, dy, k] of [[-0.6, -0.1, 0.12], [0.62, 0.05, 0.1], [0.45, -0.28, 0.07]]) {
      const x = cx + dx * s, y = cy + dy * s, r = k * s;
      ctx.fillStyle = t.accent; ctx.globalAlpha = 0.8; ctx.beginPath();
      ctx.moveTo(x, y + r * 0.9); ctx.bezierCurveTo(x - r * 1.4, y - r * 0.2, x - r * 0.5, y - r * 1.2, x, y - r * 0.4);
      ctx.bezierCurveTo(x + r * 0.5, y - r * 1.2, x + r * 1.4, y - r * 0.2, x, y + r * 0.9); ctx.fill();
    }
  } else if (o === "grihapravesh") {
    // toran of mango leaves and marigolds
    ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.012;
    ctx.beginPath(); ctx.moveTo(cx - s, cy - s * 0.45); ctx.quadraticCurveTo(cx, cy - s * 0.3, cx + s, cy - s * 0.45); ctx.stroke();
    for (let i = 0; i <= 12; i++) {
      const p = i / 12, x = cx - s + p * 2 * s, y = cy - s * 0.45 + 4 * p * (1 - p) * s * 0.075;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI);
      petal(ctx, s * 0.16, s * 0.05); ctx.fillStyle = i % 2 ? "#2f7d32" : "#4caf50"; ctx.fill(); ctx.restore();
      if (i % 2 === 0) { ctx.fillStyle = "#ff9800"; ctx.beginPath(); ctx.arc(x, y + s * 0.02, s * 0.035, 0, 7); ctx.fill(); }
    }
    // kalash
    const ky = cy + s * 0.12;
    ctx.fillStyle = t.accent;
    ctx.beginPath(); ctx.ellipse(cx, ky + s * 0.1, s * 0.2, s * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(cx - s * 0.08, ky - s * 0.12, s * 0.16, s * 0.1);
    ctx.fillStyle = t.soft; ctx.fillRect(cx - s * 0.2, ky + s * 0.06, s * 0.4, s * 0.03);
    for (let i = -2; i <= 2; i++) { ctx.save(); ctx.translate(cx + i * s * 0.05, ky - s * 0.12); ctx.rotate(i * 0.35); petal(ctx, s * 0.16, s * 0.05); ctx.fillStyle = "#3d8b40"; ctx.fill(); ctx.restore(); }
    ctx.fillStyle = "#c46a1b"; ctx.beginPath(); ctx.arc(cx, ky - s * 0.2, s * 0.07, 0, 7); ctx.fill();
    ctx.fillStyle = "#d32f2f"; ctx.font = `700 ${s * 0.12}px ${SERIF}`; ctx.textAlign = "center"; ctx.fillText("ॐ", cx, ky + s * 0.15);
  } else if (o === "babyshower") {
    ctx.fillStyle = t.accent;
    crescent(ctx, cx, cy, s * 0.3, s * 0.13, -s * 0.1, s * 0.27);
    for (const [dx, dy, k] of [[0.45, -0.25, 0.06], [0.6, 0.05, 0.04], [-0.55, -0.2, 0.05], [0.25, 0.25, 0.035], [-0.4, 0.2, 0.04]]) { ctx.fillStyle = t.soft; star(ctx, cx + dx * s, cy + dy * s, k * s); ctx.fill(); }
  } else if (o === "puja") {
    emblem(ctx, "kalash", cx, cy + s * 0.05, s * 0.3, t);
    for (const side of [-1, 1]) diya(ctx, cx + side * s * 0.55, cy + s * 0.2, s * 0.1, t);
  } else if (o === "mundan") {
    emblem(ctx, "mandala", cx, cy, s * 0.28, t);
    for (const [dx, dy, k] of [[0.5, -0.2, 0.05], [-0.55, -0.15, 0.045], [0.6, 0.15, 0.035], [-0.45, 0.2, 0.04]]) { ctx.fillStyle = t.soft; star(ctx, cx + dx * s, cy + dy * s, k * s); ctx.fill(); }
  } else if (o === "upanayan") {
    ctx.strokeStyle = "#fff6d5"; ctx.lineWidth = s * 0.012;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(cx, cy + k * s * 0.015, s * 0.32, s * 0.4, 0.5, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = t.accent; ctx.beginPath(); ctx.arc(cx + s * 0.18, cy + s * 0.32, s * 0.04, 0, Math.PI * 2); ctx.fill();
    diya(ctx, cx, cy + s * 0.12, s * 0.12, t);
  } else if (o === "inauguration") {
    ctx.fillStyle = "#d62828";
    ctx.fillRect(cx - s, cy - s * 0.03, s * 2, s * 0.06);
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo(cx + sd * s * 0.3, cy - s * 0.3, cx + sd * s * 0.28, cy); ctx.quadraticCurveTo(cx + sd * s * 0.3, cy + s * 0.3, cx, cy); ctx.fill(); }
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + sd * s * 0.12, cy + s * 0.4); ctx.lineTo(cx + sd * s * 0.04, cy + s * 0.36); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = t.accent; ctx.beginPath(); ctx.arc(cx, cy, s * 0.05, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; ctx.fillStyle = k % 2 ? t.soft : t.accent; star(ctx, cx + Math.cos(a) * s * 0.7, cy - s * 0.25 + Math.sin(a) * s * 0.18, s * 0.025, 4, 0.4); ctx.fill(); }
  } else if (o === "retirement") {
    glow(ctx, cx, cy + s * 0.15, s * 0.55, "rgba(255,190,90,0.5)");
    ctx.fillStyle = t.accent; ctx.beginPath(); ctx.arc(cx, cy + s * 0.2, s * 0.25, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = t.accent; ctx.lineWidth = s * 0.01; ctx.beginPath(); ctx.moveTo(cx - s * 0.7, cy + s * 0.2); ctx.lineTo(cx + s * 0.7, cy + s * 0.2); ctx.stroke();
    for (let k = 0; k < 3; k++) { ctx.globalAlpha = 0.6 - k * 0.15; ctx.beginPath(); ctx.moveTo(cx - s * (0.5 - k * 0.1), cy + s * (0.28 + k * 0.05)); ctx.lineTo(cx + s * (0.5 - k * 0.1), cy + s * (0.28 + k * 0.05)); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.fillStyle = t.soft;
    for (const [dx, dy, k] of [[-0.45, -0.25, 0.05], [0.5, -0.3, 0.04], [0.1, -0.4, 0.035]]) { star(ctx, cx + dx * s, cy + dy * s, k * s); ctx.fill(); }
  } else if (o === "sangeet") {
    ctx.fillStyle = t.accent;
    ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.08, s * 0.4, s * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = t.soft; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sd * s * 0.4, cy + s * 0.08, s * 0.05, s * 0.17, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = t.bg[1]; ctx.lineWidth = s * 0.006; for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(cx - s * 0.35, cy + s * 0.08 + k * s * 0.02); ctx.lineTo(cx + s * 0.35, cy + s * 0.08 - k * s * 0.02); ctx.stroke(); }
    ctx.fillStyle = t.soft; ctx.font = `700 ${s * 0.2}px ${SERIF}`; ctx.textAlign = "center";
    ctx.fillText("♪", cx - s * 0.55, cy - s * 0.15); ctx.fillText("♫", cx + s * 0.55, cy - s * 0.2); ctx.fillText("♪", cx + s * 0.15, cy - s * 0.32);
  } else if (o === "prayer") {
    emblem(ctx, "lotus", cx, cy + s * 0.05, s * 0.28, t);
    diya(ctx, cx, cy - s * 0.12, s * 0.1, t);
  } else {
    mandala(ctx, cx, cy, s * 0.3, t);
    for (const side of [-1, 1]) diyaSmall(ctx, cx + side * s * 0.6, cy + s * 0.12, s * 0.11, t);
  }
  ctx.restore();
}

function diyaSmall(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: Theme) { diya(ctx, x, y, s, t); }

export function partySize(vertical: boolean): [number, number] { return vertical ? [1080, 1920] : [1080, 1512]; }

export function drawParty(ctx: CanvasRenderingContext2D, p: Party, photo: Pic | null, vertical: boolean, ov?: Overrides): Item[] {
  return edited(ov, () => {
    const [w, h] = partySize(vertical);
    const o = OCCASIONS[p.occasion], t = theme(p.theme);
    const hi = p.lang !== "en", en = p.lang !== "hi";
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    background(ctx, w, h, t, p.frame);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    const cx = w / 2, U = w / 1080, inner = w * 0.72;
    const top = h * (vertical ? 0.1 : 0.08), foot = h - h * 0.075;
    const qrSize = 150 * U, hasQr = !!p.qr;
    const limit = foot - (hasQr ? qrSize + 72 * U : 46 * U);
    const scratch = document.createElement("canvas").getContext("2d")!;
    scratch.textAlign = "center";
    const end = quiet(() => body(scratch, 1));
    body(ctx, end > limit ? Math.max(0.55, (limit - top) / (end - top)) : 1);
    const u = U;
    if (hasQr) {
      const q = place("qr", cx - qrSize / 2, foot - qrSize - 30 * u, qrSize, qrSize);
      if (!q.hidden) drawQr(ctx, p.qr, q.x, q.y, q.w, t);
      ctx.fillStyle = t.soft; ctx.font = `400 ${20 * u}px ${SERIF}`;
      say(ctx, "qrlabel", hi && !en ? "स्थान / RSVP के लिए स्कैन करें" : "Scan for location / RSVP", cx, foot - qrSize - 42 * u);
    }
    if (p.rsvp) { ctx.fillStyle = t.ink; ctx.font = `400 ${24 * u}px ${SERIF}`; say(ctx, "rsvp", `${hi && !en ? "संपर्क" : "RSVP"}: ${p.rsvp}`, cx, foot + 6 * u); }
    ctx.restore();

    function body(ctx: CanvasRenderingContext2D, k: number): number {
      const u = U * k;
      let y = top;
      const lines = (id: string, text: string, step: number) => wrap(ctx, text, inner).forEach((l, i) => { say(ctx, `${id}.${i}`, l, cx, y); y += step; });
      occasionArt(ctx, p.occasion, cx, y + 120 * u, 300 * u, t);
      y += 300 * u;
      ctx.fillStyle = t.accent;
      if (hi) { fit(ctx, o.hi, (px) => `700 ${px}px ${SERIF}`, 70 * u, inner); say(ctx, "title.hi", o.hi, cx, y); y += 64 * u; }
      if (en) {
        const font = (px: number) => (hi ? `400 ${px}px ${SERIF}` : `${px}px ${SCRIPT}`);
        fit(ctx, o.en, font, (hi ? 32 : 100) * u, inner); say(ctx, "title.en", o.en, cx, y); y += (hi ? 42 : 80) * u;
      }
      divider(ctx, cx, y, inner * 0.7, t);
      y += 60 * u;
      ctx.fillStyle = t.ink;
      if (en) { ctx.font = `italic 400 ${30 * u}px ${SERIF}`; lines("invite", p.host ? `${p.host}: ${o.inviteEn}` : o.inviteEn, 42 * u); y += 16 * u; }
      if (photo) {
        const r = 120 * u;
        const b = place("photo", cx - r, y, r * 2, r * 2);
        if (!b.hidden) photoCircle(ctx, photo, b.x + b.w / 2, b.y + b.h / 2, b.w / 2, t);
        y += r * 2 + 56 * u;
      }
      const name = (hi && !en ? p.nameHi || p.name : p.name) || (p.occasion === "grihapravesh" ? "Our New Home" : "Name");
      const nf = (px: number) => (hi && !en ? `700 ${px}px ${SERIF}` : `${px}px ${SCRIPT}`);
      const np = fit(ctx, name, nf, 120 * u, inner);
      ctx.fillStyle = t.accent;
      say(ctx, "name", name, cx, y + np * 0.45); y += np * 0.85;
      if (hi && en && p.nameHi) { ctx.fillStyle = t.soft; ctx.font = `600 ${38 * u}px ${SERIF}`; say(ctx, "name.hi", p.nameHi, cx, y + 10 * u); y += 52 * u; }
      if (p.number && o.numberLabel) {
        ctx.fillStyle = t.ink; ctx.font = `700 ${40 * u}px ${SERIF}`;
        const line = en
          ? p.occasion === "birthday" ? `${o.numberLabel[0]} ${p.number}` : `${p.number} ${o.numberLabel[0]}`
          : `${p.number}${o.numberLabel[1]}`;
        say(ctx, "number", line, cx, y + 18 * u); y += 60 * u;
      }
      y += 6 * u;
      if (hi) { ctx.fillStyle = t.ink; ctx.font = `400 ${30 * u}px ${SERIF}`; lines("inviteHi", o.inviteHi, 42 * u); y += 6 * u; }
      divider(ctx, cx, y + 12 * u, inner * 0.5, t);
      y += 66 * u;
      ctx.fillStyle = t.accent;
      const dateLine = [formatDate(p.date, hi && !en), formatTime(p.time, hi && !en)].filter(Boolean).join(" · ");
      fit(ctx, dateLine, (px) => `700 ${px}px ${SERIF}`, 38 * u, inner);
      if (dateLine) { say(ctx, "date", dateLine, cx, y); y += 52 * u; }
      if (hi && en && p.date) { ctx.fillStyle = t.soft; ctx.font = `400 ${28 * u}px ${SERIF}`; say(ctx, "date.hi", [formatDate(p.date, true), formatTime(p.time, true)].filter(Boolean).join(" · "), cx, y); y += 44 * u; }
      ctx.fillStyle = t.ink; ctx.font = `600 ${32 * u}px ${SERIF}`;
      lines("venue", p.venue, 42 * u);
      if (p.address) { ctx.font = `400 ${26 * u}px ${SERIF}`; lines("addr", p.address, 36 * u); }
      return y;
    }
  });
}

export const PARTY_THEMES = THEMES;
