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
 *
 * The bytes below are the bolt, matching the `⚡/` namespace the add-on writes into
 * the mailbox. They were a solid blue square for the whole of the first rollout:
 * /logo.png returned 200, the rail drew an icon, and nothing anywhere reported a
 * problem — the endpoint was checked for a status code rather than for a picture.
 * Decode it and look at it when changing this.
 */
export const LOGO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAADyUlEQVR42u2dsWoVURCGz8v4BL6AT5BesLRJZRmwNn2wtUllZ5NWrA0WFoqSIohgCMRCCKRIIawHFw/Xe3fPPRtuduab/Yep7u32W5j//DNnNj3Ye680zKRHIAACoBQAAVAKgAAoBUAAlAIgAEoB2EXuPfskAJb55t1PATDLF6++C4BZPnz84frm98vXPwTAJvOj77pu//BMAAzy0dOP3d9QEbbJt6e/egCSoQb55PmX/ulfXN0KgEF+/XbTAzj9fC0Ac+fB0Xn3L45PLgXAQHoWAPkcIAAG0rNELgYCMKv0XH39c+RfBGBW26f7P+SGGkjPElkLCcB8mRXnGoB8FhMAA+lZAmHDRQCQpWc+8W4CyFQEwEB64jQoG8DayWs18l8CYCA9+8hU1JSfo+HejQTFhmMD2JSeJRCtYDaA/cOzbjxAGpQKYFB6lkC0gsEAxqRnCUQrmAqgIj1xNhwSwPHJZf3pU1rBSABl3qQSLA0KA1CRnrhWMA/Apuk/GJRWMA9AXXoSbTgSgPxed21BaQWTALRIT6gGZQDYevIitoIxAFqkJ7EVjAFQRp1bgmXDAQA0Sk9iK5gBoIw6NwZOg7oGMDhvUg9QK9g7gEnSc1dh4iMluvTcYZgc4pJP6Tn/62+loDwCGJs3ub+4uLq1qh+JLj13EoZtZHcAWkz/ALXXKYA7SE9o7fUIYGzUOWTt9QhgfumZtZb52S0t+eTlwTtKi5WeTuYnXACojDrfXzgZoEvLlJ5+plfsAdRHnaPWXkcA5peervo2aWnS09vsYlqa9PTWNbMEsHXUeefh8PaSGYBJ8ybxaq89gPmlp8+5Xd4VpfwW3+Hpux2a4wG4W8fG7cRKwEt6rJvDPABTbTuftRcMYOq4nPOBUR6AqeMOmoyzNK79T4vCAEzq2iOuC6SoEijXXsR9MRiA9vMz5bIGDECjewpaWEAC0G5CaGmfpQmhlWXGFZh1V5sEoMWEwF2UJAHYakIYjvkvAoDnMf/4ALaaELhVTTAAW00I3J4UGIC6BCIuKYABqJgQzlsuQQBUTAjiiggYgIoJAa29MAAVE4K1J5cKYKwC45ZUUgEMmhDo2gsDMGhCoGsvDEC82ksCMGhCEJdjUQFsmhCsj5TgAaxJoBi1lwRgzYTArefGA1g1IYi7cdkA1kyIMLUXA2DVhIhUezEASgUOVnsxAIoJwW25sAH0JgTu20hxAEStvQwAvQlB/CpAEAAHR+eUMf+YAHLhjVp7GQBCCn9YDRAApQAIgFIABEApAAKgFAABUAqAACgFIEz+Aea2169ys4B+AAAAAElFTkSuQmCC';
