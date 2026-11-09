// Secrets that only exist in S3 mode, so they cannot be listed in secrets.required.
interface Env {
	S3_ACCESS_KEY_ID?: string;
	S3_SECRET_ACCESS_KEY?: string;
}
