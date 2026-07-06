// Wrap a bare promise (an external SDK call with no cancellation) so a hung
// call rejects with a distinct, labelled timeout error instead of pinning the
// request that awaits it (REFERENCE_SECURITY_AUDIT.md 3.5, audit H4). The
// underlying operation is not truly cancelled; the caller stops waiting for it.
export const withTimeout = async <OperationResult>(
  operation: Promise<OperationResult>,
  label: string,
  timeoutMs: number,
): Promise<OperationResult> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutGuard = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, timeoutGuard]);
  } finally {
    clearTimeout(timeoutHandle);
  }
};
