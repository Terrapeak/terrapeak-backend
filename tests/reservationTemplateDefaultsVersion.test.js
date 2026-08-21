import { expect, it } from "vitest";
import { RESERVATION_TEMPLATE_DEFAULTS_VERSION } from "../utils/reservationTemplateDefaultsVersion.js";
it("has a template defaults contract version", () => expect(RESERVATION_TEMPLATE_DEFAULTS_VERSION).toBe(1));
