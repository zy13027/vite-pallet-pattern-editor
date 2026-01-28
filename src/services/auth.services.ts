import { RequestConfig, ApiLogin } from '@siemens/simatic-s7-webserver-api';
import { RequestConfigService } from './request-config.service';

export class AuthService {
    private authToken: string | null = null;
    private config: RequestConfig;

    constructor(private requestConfigService: RequestConfigService) {
        this.config = this.requestConfigService.createConfig('https', false);
    }

    async loginToPLC(plcAddress: string, username: string, password: string): Promise<boolean> {
        try {

            const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null;

            this.config.address = plcAddress;

            // Execute login request
            const login = await new ApiLogin(this.config, username, password, false).execute();

            if (login && login.result) {
                this.authToken = login.result;

                // Store token and credentials if storage is available
                if (storage) {
                    storage.setItem('authToken', login.result);
                    storage.setItem('plcAddress', plcAddress);
                    storage.setItem('username', username);
                    storage.setItem('password', password);
                }


                if (typeof window !== 'undefined') {

                    (window as any).authToken = this.authToken;
                }


                console.log('Login successful!');
                return true;
            } else {

                if (typeof window !== 'undefined') {

                    window.alert('Login failed. Please check your credentials.');
                }


                console.error('Login failed:', login?.error || 'Unknown error');
                return false;
            }
        } catch (error) {

            if (typeof window !== 'undefined') {

                window.alert('An error occurred during login.');
            }


            console.error('Error during login:', error);
            return false;
        }
    }

    startPeriodicLogin(): void {

        const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null;

        const plcAddress = storage ? storage.getItem('plcAddress') : null;
        const username = storage ? storage.getItem('username') : null;
        const password = storage ? storage.getItem('password') : null;

        if (plcAddress && username && password) {

            if (typeof setInterval !== 'undefined') {
                setInterval(async () => {
                    const loginSuccess = await this.loginToPLC(plcAddress, username, password);
                    if (!loginSuccess) {

                        console.warn('Failed to refresh auth token.');
                    }
                }, 60000); // Refresh every 1 minute
            }
        }
    }

    getAuthToken(): string | null {

        const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
        return this.authToken || (storage ? storage.getItem('authToken') : null);
    }
}

