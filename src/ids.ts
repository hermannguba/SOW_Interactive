export type IdGenerator = () => string;

export function randomIds(): IdGenerator {
  return () => crypto.randomUUID();
}
