export function getDenomPrefix(portId: string, channelId: string): string {
    return `${portId}/${channelId}/`;
}