## jtdva
由于`dva`已经3年多没有更新了，同时也依赖较多其他插件，会出现一些问题

`很难与React更新同步`，`控制台各种生命周期的警告`，`对后期进行技术栈升级或者重构带来很多阻碍`

该怎么移除`dva`呢，去修改基于`dva`开发的N多界面是不现实的，
所以就想着去模拟api实现一套小插件来替代`dva`，同时删除不是必需的功能api

## 效果

1. 减少大概200K文件体积

2. 后期能更好的进行技术栈迭代更新或者重构打好基础，没有阻碍

3. 控制台不再出现黄色的React生命周期警告和dva状态卸载警告

## 移除dva 模拟实现导致的变动

### Api变动

- _app.model => connect.model
- _app.start => ReactDOM.render
- _app._store.dispatch => connect.dispatch
- _app._store.getState => connect.getState
- _app._models: Function => connect.models: object

### 功能/调用变动

- 支持take，takeEvery，takeLatest，select，put，put.resolve，all，call

- call不支持调用Generator

- 不支持fork，不用yield就是异步了，不需要这个函数

- 没有redux，所以也没有中间件相关方法

- 不支持模型中的subscribe，不是必要功能

- 不需要通过getWrappedInstance获取组件实例，可与普通组件类似，直接使用ref

- 去掉dva/loading插件，不提供全局loading状态，需要自己维护loading状态，不再支持如下使用方式获取当前action执行情况
    ```js 
    this.props.loading.effects['IOTHistoryCurve/fetchCurve']
    ```

- 去掉redux中connect函数中第二和第三个参数，换成模型的namespace[]数组，必传，缩小更新范围，优化性能
    ```js
    connect(({ namespace: { path }, namespace1:{ path1 } }) => ({ path, path1 }),['namespace','namespace1'],{ withRef:true })
    ```

- class组件 需要先装饰umas再装饰connect
    ```js
    @connect(({ namespace: { path }, namespace1:{ path1 } }) => ({ path, path1 }),['namespace','namespace1'],{ withRef:true })
    @umas({ style, model })
    class Top extends React.Component {}
    ```

- effects如果是Generator，则返回Promise,值为return或者最后一个yield
    ```js
    dispatch({type:'IOTHistoryCurve/fetchCurve', iotModelId: 1}).then(returnOrYieldData => {})
    ```

- effects的Generator中Promise接口报错时，程序不再继续往下执行，会抛出异常，抛出异常后会继续执行`try{}catch(err){}`之后的程序
    ```js
    {
        fetchCurve: [
            function* (action, { select, put, all, take, call }) {
                const { data, data: { success }, error } = yield $fetch(1000078, { iotModelId: action.iotModelId })
                if(!success || !data.success){
                    console.log('请求失败，错误信息：', error)
                }
                //不需要try Catch，且下面的代码不会继续执行
                //...
                return promiseValue
            },
            'takeLatest'
        ]
    }
    ```

### Api/调用新增

- 新增Hook useUmas，自动装载/卸载model和style，参数与umas一致，没有返回值
    ```js
    function Top() {
        useUmas({ style, model })
    }
    ```

- 新增Hook useConnect，只有2个参数，功能都与connect函数前2个参数保持一致，返回`[state,dispatch]`
    ```js
    function Top() {
        const [state, dispatch] = useConnect(({ namespace: { path }, namespace1:{ path1 } }) => ({ path, path1 }),['namespace','namespace1'])
    }
    ```

- 如果没有加载model，需要先useUmas，再useConnect
   ```js
    function PageEntry() {
        useUmas({ style, model })
        const [state, dispatch] = useConnect(({ namespace: { path } }) => ({ path }),['namespace'])
    }
    ```

## 插件变动

### 插件移除

- dva
- dva-loading
- redux
- react-redux
- react-router
- react-router-redux

### 插件更新

- react-router-dom 4.3.1=>6.3.0
