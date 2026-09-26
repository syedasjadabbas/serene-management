/**
 * Password policy (isomorphic: used by request schemas and forms). Length is
 * the only rule, per NIST SP 800-63B; the upper bound caps argon2 input.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
