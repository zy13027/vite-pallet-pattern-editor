import { RequestConfig } from '@siemens/simatic-s7-webserver-api'; // Adjust the import path


export class RequestConfigService {
  constructor() {}

  createConfig(protocol: string, verifyTls: boolean): RequestConfig {
    const config = new RequestConfig();
    
    config.protocol = protocol;
    config.verifyTls = verifyTls;
    return config;
  }

}
