export class RetainedStore {
  private byTopic = new Map<string, unknown>();

  set(topic: string, payload: unknown): void {
    this.byTopic.set(topic, payload);
  }

  get(topic: string): unknown {
    return this.byTopic.get(topic);
  }

  clear(): void {
    this.byTopic.clear();
  }
}
