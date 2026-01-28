
import { PlcProgramRead, PlcProgramWrite, RequestConfig } from '@siemens/simatic-s7-webserver-api';


export class PlcProgramService {
  createPlcProgramRead(
    config: RequestConfig, 
    authToken: string,  
    Var: string, 
    mode?: string
  ): PlcProgramRead {
    return new PlcProgramRead(config, authToken, Var, mode);
  }
  createPlcProgramWrite(
    config: RequestConfig,
    authToken: string,
    Var: string, 
    value: unknown, 
    mode?: string
  ): PlcProgramWrite {
    return new PlcProgramWrite(config, authToken, Var, value, mode);
  }
}
