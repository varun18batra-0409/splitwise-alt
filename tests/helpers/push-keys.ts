// Real-looking push details for tests: an address on a supported push service and keys of the right size
// (65 bytes starting 0x04, and 16 bytes), so rows pass the same check the app does before every send.
export const GOOD_P256DH = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url");
export const GOOD_AUTH = Buffer.alloc(16, 9).toString("base64url");
export const goodEndpoint = (tail: string) => `https://fcm.googleapis.com/fcm/send/${tail}`;
