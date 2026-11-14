type LogEvent = {
  message: string;
  jobId?: string;
  userId?: string;
  status?: string;
  errorCode?: string;
  model?: string;
  ms?: number;
  usage?: { prompt?: number; completion?: number; total?: number };
};

export function logEvent(event: LogEvent): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
}
