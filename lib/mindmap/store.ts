export function nextNodeId(): string {
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export function resetMap(): void {}
export function update(...args: any[]): void {}
