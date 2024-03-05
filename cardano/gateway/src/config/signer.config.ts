const signerConfig = () => ({
  sk: process.env.SK,
  address: process.env.ADDRESS,
});

export type ISignerConfig = ReturnType<typeof signerConfig>;

export default signerConfig;
