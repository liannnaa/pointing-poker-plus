type ShareLinkProps = {
  code: string;
};

export function ShareLink({ code }: ShareLinkProps) {
  return (
    <div className="flex items-center gap-1.5">
      <code className="text-xs font-mono font-semibold tracking-widest text-muted-foreground bg-muted px-2 py-1 rounded-sm">
        {code}
      </code>
    </div>
  );
}
