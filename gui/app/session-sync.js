// GUI ↔ daemon 会话同步：全量 engineMessages 优先，items 逐条回放兜底

/**
 * @param {{ items?: object[]; engineMessages?: object[] }} convo
 */
export function buildHydratePayload(convo) {
  return {
    items: convo?.items || [],
    engineMessages: convo?.engineMessages || null,
  }
}
