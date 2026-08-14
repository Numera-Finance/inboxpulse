/**
 * The add-on logo, embedded.
 *
 * The deployment manifest pointed at https://emailsentiment.mystartupcfo.com/logo.png,
 * a host that no longer resolves, so the icon rendered as an empty grey circle in the
 * Gmail rail — the one piece of the add-on a user sees before they click anything.
 *
 * Embedded rather than fetched from a bucket or a CDN: the add-on service must be up
 * for the panel to work at all, so serving the logo from it removes a dependency that
 * can rot independently. This is the same class of failure as the tunnel URL — an
 * external address written down once and never checked again.
 */
export const LOGO_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAA+UlEQVR4nO3RQQ0AIAzAwPlCCtIxg4w9ekkFNLk592mxWT+IBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtAABoBwBAOwAA2gEA0A4AgHYAALQDAKAdAADtPh6fRWVHzgIZAAAAAElFTkSuQmCC';
