export interface EnvironmentConfig {
  envName: 'test' | 'staging' | 'production';
  frontendDomain: string;
  apiDomain: string;
  resourcePrefix: string;
  tags: Record<string, string>;
}
