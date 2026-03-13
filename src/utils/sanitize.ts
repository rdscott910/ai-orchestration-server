/**
 * Strip shell metacharacters from user-provided input before it is passed
 * as an argument to a CLI process.
 *
 * WHY THIS EXISTS alongside execFile (which doesn't invoke a shell):
 * execFile is the primary injection defense — it passes args as a raw argv
 * array, never interpolating them through /bin/sh. However, some CLI tools
 * (like cursor --command) may themselves eval or interpolate their arguments.
 * Stripping metacharacters here provides defense-in-depth against those
 * downstream evaluation paths.
 *
 * Characters removed:
 *   `  - command substitution
 *   $  - variable expansion
 *   |  - pipe
 *   ;  - command separator
 *   &  - background / AND operator
 *   >  - output redirect
 *   <  - input redirect
 *   \n - newline (command terminator)
 *   \r - carriage return
 *   (  - subshell open
 *   )  - subshell close
 *   {  - brace expansion open
 *   }  - brace expansion close
 */
const SHELL_METACHARS = /[`$|;&><\n\r(){}]/g;

export function sanitizeForShell(input: string): string {
  return input.replace(SHELL_METACHARS, "").trim();
}
