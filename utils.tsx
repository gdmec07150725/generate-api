export const genQueryPath = (
  params: any = {}, // 业务传进来的URL参数
  query: string[], // 需要传给后台的查询字符串字段
  fullPath: string // 接口完整路径
) => {
  if (query.length > 0) {
    const paramsList: string[] = query.filter((item: string) => item in params);
    return paramsList.length > 0
      ? `${fullPath}?${paramsList
          .map((d: string) => `${d}=${params[d]}`)
          .join("&")}`
      : fullPath;
  }
  return fullPath;
};
