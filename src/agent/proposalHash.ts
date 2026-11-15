/** Hash de contenido usado por las propuestas (`sha256:<hex>`). */
import { createHash } from 'node:crypto';

export function hashContent(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}
