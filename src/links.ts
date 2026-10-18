export const LIST_URL = `${import.meta.env.BASE_URL}?view=list`
export const ROOM_URL = `${import.meta.env.BASE_URL}?view=room`
/** The public CV (public/Roi-Yotvat-CV.pdf), served next to index.html. */
export const CV_FILE = 'Roi-Yotvat-CV.pdf'
export const CV_URL = `${import.meta.env.BASE_URL}${CV_FILE}`
/** The live address of the CV, as the duck's answer spells it out (rewritten to CV_URL when rendered). */
export const CV_LIVE_URL = `https://roiyot26.github.io/desk-3d/${CV_FILE}`
