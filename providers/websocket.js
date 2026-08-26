import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export function openWebsocket(session, websocketUrl, cancellable = null) {
    const message = Soup.Message.new('GET', websocketUrl);
    return new Promise((resolve, reject) => {
        session.websocket_connect_async(message, null, [], GLib.PRIORITY_DEFAULT, cancellable, (_session, result) => {
            try {
                resolve(session.websocket_connect_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

export function closeWebsocket(websocket) {
    const state = websocket.get_state();
    if (state !== Soup.WebsocketState.CLOSING && state !== Soup.WebsocketState.CLOSED)
        websocket.close(1000, null);
}
