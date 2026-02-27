/**
 * Represents a single validation issue found in the JSON input.
 */
export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Thrown when the JSON input violates the XSD schema constraints (strict mode).
 */
export class XsdValidationError extends Error {
  public readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    const summary = issues.map((i) => `  [${i.path}] ${i.message}`).join('\n');
    super(`JSON validation against XSD schema failed:\n${summary}`);
    this.name = 'XsdValidationError';
    this.issues = issues;
    Object.setPrototypeOf(this, XsdValidationError.prototype);
  }
}

/**
 * Thrown when a structural mapping error occurs during XML generation
 * (e.g., an unknown element name or type reference that cannot be resolved).
 */
export class XsdMappingError extends Error {
  public readonly path: string;

  constructor(path: string, message: string) {
    super(`XSD mapping error at [${path}]: ${message}`);
    this.name = 'XsdMappingError';
    this.path = path;
    Object.setPrototypeOf(this, XsdMappingError.prototype);
  }
}

/**
 * Thrown when the XSD file cannot be read or parsed.
 */
export class XsdParseError extends Error {
  // Explicit declaration needed as Error.cause requires lib ES2022+.
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'XsdParseError';
    this.cause = cause;
    Object.setPrototypeOf(this, XsdParseError.prototype);
  }
}
