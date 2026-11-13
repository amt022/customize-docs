/** English / Hindi for the main screens (hub, tabs, exam checklist, PDF Studio start page, footer).
 *  Strings are keyed by their English text, so a missing translation simply shows English.
 *  The detailed editor panels stay in English for now. */
import { useEffect, useState } from "react";

export type Lang = "en" | "hi";
const KEY = "formeasy.lang";
const EVENT = "formeasy:lang";

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "hi" || v === "en") return v;
  } catch { /* storage unavailable */ }
  return "en";
}

let current: Lang = initial();
document.documentElement.lang = current;

export const getLang = () => current;

export function setLang(l: Lang) {
  current = l;
  document.documentElement.lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Re-render the calling component when the language changes. */
export function useLang(): Lang {
  const [l, set] = useState(current);
  useEffect(() => {
    const on = () => set(current);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return l;
}

/** Translate; `{name}` placeholders are filled from `vars`. */
export function t(en: string, vars?: Record<string, string | number>): string {
  let s = current === "hi" ? HI[en] ?? en : en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

const HI: Record<string, string> = {
  // header / tabs
  "🏠 Home": "🏠 होम",
  "🪪 Photo & Signature": "🪪 फ़ोटो और हस्ताक्षर",
  "📄 PDF Studio": "📄 PDF स्टूडियो",
  "📋 Checklist": "📋 चेकलिस्ट",
  "Sign in": "साइन इन",
  "Switch to English": "Switch to English",
  "हिंदी में देखें": "हिंदी में देखें",

  // hub
  "Get every application requirement ready": "आवेदन की हर ज़रूरत तैयार करें",
  "Photos, signatures and documents for government exams, jobs and admissions: made to the exact size, format and file limits, and checked before you upload.":
    "सरकारी परीक्षा, नौकरी और एडमिशन के लिए फ़ोटो, हस्ताक्षर और दस्तावेज़: सही साइज़, फ़ॉर्मेट और फ़ाइल सीमा में, अपलोड से पहले जाँचे हुए।",
  "Exact pixels and KB": "सटीक पिक्सेल और KB",
  "JPG · PNG · WebP · PDF": "JPG · PNG · WebP · PDF",
  "Runs in your browser": "आपके ब्राउज़र में चलता है",
  "Free, no sign-up": "मुफ़्त, साइन-अप ज़रूरी नहीं",
  "Photo & Signature": "फ़ोटो और हस्ताक्षर",
  "Resize and crop to exact dimensions, set a file size in KB, convert format, remove the background and check against the limits.":
    "सटीक माप में साइज़ और क्रॉप करें, KB में फ़ाइल साइज़ तय करें, फ़ॉर्मेट बदलें, बैकग्राउंड हटाएँ और सीमाओं से जाँचें।",
  "PDF Studio": "PDF स्टूडियो",
  "Edit text and pictures in certificates and forms, compress to a size limit, merge, split, and run a document check.":
    "सर्टिफ़िकेट और फ़ॉर्म में टेक्स्ट और फ़ोटो बदलें, साइज़ सीमा तक छोटा करें, जोड़ें, अलग करें और दस्तावेज़ जाँचें।",
  "Exam Checklist": "परीक्षा चेकलिस्ट",
  "Pick your exam and tick off the photo, signature and documents it asks for.":
    "अपनी परीक्षा चुनें और उसके लिए ज़रूरी फ़ोटो, हस्ताक्षर और दस्तावेज़ पर टिक लगाएँ।",
  "Open": "खोलें",
  "Quick PDF tools": "तुरंत PDF टूल",
  "One click: choose your file and get the result.": "एक क्लिक: फ़ाइल चुनें और नतीजा पाएँ।",
  "Compress PDF": "PDF छोटा करें",
  "Under 100 KB, 200 KB, 500 KB…": "100 KB, 200 KB, 500 KB से कम…",
  "Merge PDFs": "PDF जोड़ें",
  "Join several files into one": "कई फ़ाइलों को एक में जोड़ें",
  "Split PDF": "PDF अलग करें",
  "Take out the pages you need": "ज़रूरी पेज निकालें",
  "JPG to PDF": "JPG से PDF",
  "Photos or scans into one PDF": "फ़ोटो या स्कैन से एक PDF",
  "PDF to JPG": "PDF से JPG",
  "Each page as a picture": "हर पेज एक फ़ोटो के रूप में",
  "Edit PDF text": "PDF टेक्स्ट बदलें",
  "Fix a name, date or figure": "नाम, तारीख़ या अंक ठीक करें",
  "Resize photo": "फ़ोटो का साइज़ बदलें",
  "Exact pixels, cm and KB": "सटीक पिक्सेल, सेमी और KB",
  "How it works": "कैसे काम करता है",
  "Choose your exam": "अपनी परीक्षा चुनें",
  "We load its photo, signature and file-size rules.": "हम उसके फ़ोटो, हस्ताक्षर और फ़ाइल साइज़ के नियम लोड करते हैं।",
  "Upload your photo or PDF": "अपनी फ़ोटो या PDF अपलोड करें",
  "From your phone camera, gallery or computer.": "फ़ोन कैमरा, गैलरी या कंप्यूटर से।",
  "Download, ready to upload": "डाउनलोड करें, अपलोड के लिए तैयार",
  "Right size, right KB, checked against the rules.": "सही साइज़, सही KB, नियमों से जाँचा हुआ।",
  "Popular exams": "लोकप्रिय परीक्षाएँ",
  "Every exam sets its own limits. Always copy them from the official notification; the examples in the tools are only examples.":
    "हर परीक्षा अपनी सीमाएँ तय करती है। उन्हें हमेशा आधिकारिक अधिसूचना से लें; टूल में दिए मान केवल उदाहरण हैं।",
  "Opening…": "खुल रहा है…",
  "Merging {n} files…": "{n} फ़ाइलें जोड़ी जा रही हैं…",

  // checklist
  "Exam document checklist": "परीक्षा दस्तावेज़ चेकलिस्ट",
  "Choose an exam to see what its application form usually asks for. Tick items as you get them ready; your ticks stay on this device.":
    "परीक्षा चुनें और देखें कि आवेदन फ़ॉर्म में आम तौर पर क्या माँगा जाता है। जो तैयार हो जाए उस पर टिक करें; टिक इसी डिवाइस पर सहेजे रहते हैं।",
  "{done} of {total} ready": "{total} में से {done} तैयार",
  "Photo, signature and thumb": "फ़ोटो, हस्ताक्षर और अँगूठा",
  "Made to the exact size and KB with the Photo & Signature tool.": "फ़ोटो और हस्ताक्षर टूल से सटीक साइज़ और KB में बनाएँ।",
  "Documents to keep ready": "तैयार रखने वाले दस्तावेज़",
  "Scan them to PDF and compress each under the portal's limit.": "इन्हें PDF में स्कैन करें और पोर्टल की सीमा से छोटा करें।",
  "Make it": "बनाएँ",
  "Scan to PDF": "स्कैन से PDF",
  "Compress": "छोटा करें",
  "if applicable": "यदि लागू हो",
  "Reset ticks": "टिक हटाएँ",
  "Rules change with every notification. Check the official notification of your exam before you upload.":
    "हर अधिसूचना के साथ नियम बदल सकते हैं। अपलोड से पहले अपनी परीक्षा की आधिकारिक अधिसूचना ज़रूर देखें।",

  // PDF studio landing
  "Edit PDF text exactly where it is": "PDF टेक्स्ट वहीं बदलें जहाँ वह है",
  "Change a word, a figure or a name. The original font, size, colour and position are kept, and every edit is checked against the original page.":
    "कोई शब्द, अंक या नाम बदलें। मूल फ़ॉन्ट, साइज़, रंग और जगह वैसी ही रहती है, और हर बदलाव मूल पेज से जाँचा जाता है।",
  "Drop a PDF here or click to choose": "PDF यहाँ छोड़ें या चुनने के लिए क्लिक करें",
  "Up to {mb} MB": "{mb} MB तक",
  "only you can see your files": "आपकी फ़ाइलें सिर्फ़ आप देख सकते हैं",
  "stays on this computer": "इसी कंप्यूटर पर रहती है",
  "Recent documents": "हाल के दस्तावेज़",
  "Images": "फ़ोटो",

  // errors
  "Can't reach FormEasy. Check your internet connection and try again.": "FormEasy से जुड़ नहीं पा रहे। इंटरनेट कनेक्शन जाँचें और फिर कोशिश करें।",
  "This file is too big to upload. Compress it or split it into parts first.": "यह फ़ाइल अपलोड के लिए बहुत बड़ी है। पहले छोटा करें या हिस्सों में बाँटें।",
  "Too many tries in a short time. Wait a minute and try again.": "कम समय में बहुत ज़्यादा कोशिशें। एक मिनट रुककर फिर कोशिश करें।",
  "Something went wrong on our side. Please try again in a moment.": "हमारी तरफ़ से कुछ गड़बड़ हुई। थोड़ी देर में फिर कोशिश करें।",
  "This PDF is password protected": "यह PDF पासवर्ड से सुरक्षित है",
  "Wrong password": "गलत पासवर्ड",
  "Unlock": "खोलें",
  "PDF password": "PDF पासवर्ड",
  "Only PDF files work here. For photos use “JPG to PDF”; save Word files as PDF first.": "यहाँ केवल PDF फ़ाइलें चलती हैं। फ़ोटो के लिए “JPG से PDF” चुनें; Word फ़ाइल को पहले PDF में सेव करें।",

  // footer
  "Privacy Policy": "गोपनीयता नीति",
  "Terms of Use": "उपयोग की शर्तें",
};
