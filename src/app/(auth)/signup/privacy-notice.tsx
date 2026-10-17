import styles from "../auth.module.css";

export function PrivacyNotice() {
  return (
    <p className={styles.privacyNotice}>
      Priority stores your email, a salted password hash (not your password), hashed sign-in tokens, and—if
      you connect Canvas—your encrypted Canvas access token and private calendar-feed link, imported classes,
      assignments, due dates, grades, and grading setup. Priority currently does not use AI or send your data
      to AI services; it contacts Canvas to retrieve the information you ask it to sync. To delete your
      account and Priority&apos;s stored copy, open Settings → Account → Delete account and type DELETE; this
      does not delete records in Canvas or revoke your Canvas token there.
    </p>
  );
}
