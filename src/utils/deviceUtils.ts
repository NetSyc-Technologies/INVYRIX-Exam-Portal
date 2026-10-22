import { GeoLocation, DeviceInfo } from '../types';

export function parseUserAgent(ua: string): { deviceName: string; browser: string; os: string } {
    let os = 'Unknown OS';
    let browser = 'Unknown Browser';
    let deviceName = 'Generic PC';

    // Parse OS
    if (/windows/i.test(ua)) {
        os = 'Windows';
        deviceName = 'Windows PC';
    } else if (/macintosh|mac os x/i.test(ua) && !/like mac/i.test(ua)) {
        os = 'macOS';
        deviceName = 'Macintosh';
    } else if (/android/i.test(ua)) {
        os = 'Android';
        deviceName = 'Android Device';
        // Try to get Android model name
        const match = ua.match(/Android\s+[^;]+;\s+([^;)]+)/);
        if (match && match[1]) {
            const model = match[1].trim();
            if (!/hp-tablet|browser|mobile|tablet|workplace/i.test(model)) {
                deviceName = model;
            }
        }
    } else if (/iphone|ipad|ipod/i.test(ua)) {
        os = 'iOS';
        if (/iphone/i.test(ua)) deviceName = 'iPhone';
        else if (/ipad/i.test(ua)) deviceName = 'iPad';
        else deviceName = 'iPod';
    } else if (/linux/i.test(ua)) {
        os = 'Linux';
        deviceName = 'Linux PC';
    } else if (/cros/i.test(ua)) {
        os = 'ChromeOS';
        deviceName = 'Chromebook';
    }

    // Parse Browser
    if (/samsungbrowser/i.test(ua)) {
        browser = 'Samsung Internet';
    } else if (/opera|opr/i.test(ua)) {
        browser = 'Opera';
    } else if (/edg/i.test(ua)) {
        browser = 'Microsoft Edge';
    } else if (/chrome|crios/i.test(ua)) {
        browser = 'Google Chrome';
    } else if (/safari/i.test(ua) && !/chrome|crios|android/i.test(ua)) {
        browser = 'Safari';
    } else if (/firefox|fxios/i.test(ua)) {
        browser = 'Firefox';
    } else if (/msie|trident/i.test(ua)) {
        browser = 'Internet Explorer';
    }

    return { deviceName, browser, os };
}

export function getGeolocation(): Promise<GeoLocation> {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by your browser'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: new Date(position.timestamp)
                });
            },
            (error) => {
                let msg = 'Unknown location error';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        msg = 'Location permission denied by user';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        msg = 'Location information is unavailable';
                        break;
                    case error.TIMEOUT:
                        msg = 'Location request timed out';
                        break;
                }
                reject(new Error(msg));
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

export function formatDeviceName(info: DeviceInfo): string {
    if (!info) return 'Unknown Device';
    const { deviceName, browser, os } = info;
    if (deviceName && browser && os) {
        return `${deviceName} (${browser} on ${os})`;
    }
    return info.userAgent || 'Unknown Device';
}
