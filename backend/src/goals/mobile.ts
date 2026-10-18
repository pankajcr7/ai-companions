// A mobile app design: a phone app named together with a design word, or "mobile design/screens/UI". A web app never counts;
// goals from the Mobile App page always do. Owner's choice (2026-10-18): "Make an iOS app" alone is building, not designing.
const PAGE = /^(?:Design a mobile app:|Mobile app design changes:)/i;
const WEB_APP = /\bweb[\s-]+app/i;
const PHONE_APP = /\b(?:mobile|ios|android|iphone|smartphone|phone)[\s-]+app(?:lication)?s?\b/i;
const DESIGN_WORD = /\b(?:re-?)?design(?:s|ing)?\b|\b(?:screens?|ui|ux|mockups?|wireframes?|prototypes?)\b/i;
const MOBILE_DESIGN = /\bmobile[\s-]+(?:design|screens?|ui|ux|mockups?|wireframes?|prototypes?)\b/i;

export const isMobileDesign = (text: string) => PAGE.test(text) || (!WEB_APP.test(text) && ((PHONE_APP.test(text) && DESIGN_WORD.test(text)) || MOBILE_DESIGN.test(text)));

/** Added to Nova's planning instructions for a mobile design goal. */
export const MOBILE_PLAN =
  'MOBILE APP DESIGN: this goal designs a mobile app. The first task is "The look and the screen list": it writes design/identity.md (app name, audience, feeling, colours as hex values, fonts from Google Fonts, spacing scale, corner radius, and the shared header, tab bar, buttons, cards and inputs) and design/screens.md (the numbered screens: file name screens/NN-name.html, purpose, key content, how it is reached). If the owner attached a screenshot, the look matches it. Every other task draws 3 or 4 screens from that list, saved as screens/NN-name.html, and depends on the first task. Plan 6 to 10 screens unless the owner asked for a number. The brief is a short summary of the look.';

/** Added to Nova's planning instructions for a follow-up to a mobile design ("Ask for changes"). */
export const MOBILE_CHANGES =
  "MOBILE APP CHANGES: this goal changes an existing mobile app design. Change only the screens the owner names (screens/NN-name.html) and keep design/identity.md and design/screens.md unless the owner asks to change them. Plan as few tasks as the change needs, usually one.";

/** Added to the instructions of every task in a mobile design goal, and to Nova's review of them. */
export const MOBILE_GUIDE = `MOBILE SCREEN GUIDE (this goal designs a mobile app):
Read design/identity.md and design/screens.md first, and draw exactly the screens your task names.
Each screen is one standalone HTML file, screens/NN-name.html, with <title> set to the screen's name and <meta name="viewport" content="width=390, initial-scale=1">, laid out for a 390×844 phone.
Use Tailwind from https://cdn.tailwindcss.com with the same tailwind.config (colours, fonts) and the same Google Fonts link in every screen.
Keep the top 47 px (status bar) and the bottom 34 px (home indicator) clear of content. Use native patterns: the tab bar or navigation bar from design/screens.md, and the same header, tab bar and buttons on every screen.
Tap targets at least 44 px; text at least 12 px; real content, no placeholders; icons as inline SVG, no emoji or icon fonts; pictures from generate_image only where they matter (about 6 free a day), otherwise colour and shape.
It must look like a real app, not a website squeezed into a phone.`;
