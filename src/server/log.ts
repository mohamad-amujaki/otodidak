type LogEvent = {
  message: string;
  jobId?: string;
  userId?: string;
  status?: string;
  errorCode?: string;
};

export function logEvent(event: LogEvent): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
}
