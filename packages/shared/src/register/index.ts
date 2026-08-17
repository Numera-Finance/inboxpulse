/**
 * The register — how displeasure is actually worded in this mail.
 *
 * Lives in shared rather than in the API because two very different consumers
 * need the same list, and a second copy would drift: the API scores it as a
 * feature, and the add-on renders it to a reader who is learning to recognise it
 * themselves. The add-on fetches bodies from Gmail directly and never calls the
 * API, so a shared module is what lets it annotate instantly, offline, with no
 * round-trip.
 */
export * from './idioms';
