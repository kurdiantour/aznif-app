export async function runMultiplayerAction<T>({
  action,
  onSuccess,
  errorLabel,
}: {
  action: () => Promise<T>;
  onSuccess: (result: T) => boolean | Promise<boolean>;
  errorLabel: string;
}): Promise<boolean> {
  try {
    return await onSuccess(await action());
  } catch (error) {
    console.warn(errorLabel, error);
    return false;
  }
}
