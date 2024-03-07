package cardano_test

import (
	"sidechain/x/clients/cardano"

	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	ibctesting "github.com/cosmos/ibc-go/v8/testing"
)

const (
	headerCbor = "828a1a0004a11c1a0012864e582040b933e31ffbb08a719d6166bb076cdf1558f3ff6130c02acd6fa15f359a7bd558205a3d778e76741a009e29d23093cfe046131808d34d7c864967b515e98dfc35835820b882007593ef70f86e5c0948561a3b8e8851529a4f98975f2b24e768dda38ce2825840802ca9735db1a7a723ca9cd609e087d7d0faa5909bd81ac0ce7e8f55e1136176eb56dfe431aa8f46225bb8e132934e7761c2b3f9ac9811347d57d74066ac23dd5850f48bd14396591beab3a3bc774428e2e72fe3650b51cc4fa6d3f974b8a9d7b8bc6d1355b1575a593e20f721eda258ba8c6118d4c264695faea0c9a43ede7f97b0410e7ae7a7a8dbbd6c202b4b851ead071914f7582073e7c8324d657fbb5acb99aeaf06aba17f9431360c4bcda97b45038ba464700c8458204cd49bb05e9885142fe7af1481107995298771fd1a24e72b506a4d600ee2b3120000584089fc9e9f551b2ea873bf31643659d049152d5c8e8de86be4056370bccc5fa62dd12e3f152f1664e614763e46eaa7a17ed366b5cef19958773d1ab96941442e0b8209005901c03d777ad131d20737d4ecf756667cfda5388402855c7a2248fcae4cf43e29e258cdaec937e93884e64f5fca3b335f3e45e1fff469ea42d96585f1a311ea8002002d4875be7df3e43d195cbf6abbbc390e7d9e835ad634f8465e1058fc28821420acd6b988d34000decbbdb5e9e7ef704f4f0b5b7d342695acd431532f606bd662ee8b43b78feb4d50d0ff2e581be6bdc28c3cb26f40e65e56df9e58dfb0afd4c411a01a0dc0602326bcd38cc15403b74c54e412a8b1ac8c6433f938bc0c112fdc841403747cc8df5ee310b858f0dc32b46e4b9e8a2b6dc0c8277afed187db1d91fb774c5d0a0aca78c53282bb3174493f3451837b6b378eca8a8a61509a0a3d5cb2394c385ec63fcd85ed56eec3de48860a1ec950aad4f91cbf741dbd7bf1d3c278875bd20e31ff5372339f6aa5280ad9b8bf3514889ac44600fe57ca0b535d6d3f53311e21199cccc0b080f28d18f4dc6987731e10e4ade00df7c6921c5ef3022b6f49a29ba307a2c8f4bd2ba42fcfa0aad68a2f0ad31fff69a99d3471f9036dda2bb36c716beae8d706bc648a790d4697e1d044a11a49f305ab8bc64a094bd81bda7395fe6f77dd5557c39919dd9bb9cf22a87fe47408ae3ec2247007d015a5"
	bodyCbor   = "818379055e6139303038323832353832306239393135336466333965383837646165653730333632323561373030303538653734376634663931396634306334386338323461306162653161653262373730303832353832306239393135336466333965383837646165653730333632323561373030303538653734376634663931396634306334386338323461306162653161653262373730313031383361333030353831643730653239613033346464613636343266353766346561333066396131356639383964336536303763363236376535373665346631653837383730313832316130303133626163386131353831636665393132613064363334633039303138353066373066656434363132663936376535623930373462333033336437653230383531303961613134373638363136653634366336353732303130323832303164383138353833346438373939666438373939663031303066666438373939663538316366653931326130643633346330393031383530663730666564343631326639363765356239303734623330333364376532303835313039613437363836313665363436633635373266666666613330303538316437306637316339373432376165373833316630393232396363663964313933663130386466623635343164373665643234646131633364333537303138323161303031616435313061313538316335393264653133383564363132363934656564313864373637393031633437333162333436363365366165633739626561636138386461626131353566353738326566313430333933343138616463643037383335666530373233633233343539623334303030313032383230316438313835383932643837393966643837393966643837393966343933303331326436333666373336643666373364383739396630323033666631623030303338643765613463363830303031623030303338643765613463363830303130316438373939663030303066666438373939663030313836346666383066666131643837393966303031383634666664383739396631623137623065623039396436666339383034313430643837393966343134306666666666666438373939663538316335393264653133383564363132363934656564313864373637393031633437333162333436363365366165633739626561636138386461623535663537383265663134303339333431386164636430373833356665303732336332333435396233343030666666663832353831643630386633313066373966393737626466306265666564666165333337346136323565363463396136396134306333633866636136303764616331613762376461666234303231613030303665363261303331613030313238366139303961313538316335393264653133383564363132363934656564313864373637393031633437333162333436363365366165633739626561636138386461626131353566353738326566313430333933343138616463643037383335666530373233633233343539623334303030313062353832306436373962363437356537336239313366633831353336646636343138383262353030663635373535343332386330666231303862396431343034663834623530643831383235383230623939313533646633396538383764616565373033363232356137303030353865373437663466393139663430633438633832346130616265316165326237373031313038323538316436303866333130663739663937376264663062656665646661653333373461363235653634633961363961343063336338666361363037646163316137623935313161663131316130303061353933667924886133303038313832353832306638303563363633623865316666343764613166343965643032663161303562396666303930373963313239346239346162386336393365343165653966383835383430353038333061383466376230363034653835353561613836346461663866343235633834653132396237333337613135616662323139363265633666313231363739326439376366646534393738313238333833646631666531656363633661333634346639373763323637646331386531323937626430383561336537306230353832383430303030643837393830383231613030303338326438316130353633666466333834303130306438373939666438373939663538316366653931326130643633346330393031383530663730666564343631326639363765356239303734623330333364376532303835313039613437363836313665363436633635373266666666383231613030303735333039316130616530633765393036383235393036323835393036323530313030303033333332333233323332333233323332333233323233323233323232323332333233323332353333333030653332333233323332333233323332333233323332353333333031383333303031303037333030613330313630313131333233323533333330316433303230303032313533333330316133333030333030313330306333303138303133313332333233323332353333333031653333373065393030303030313061393939383066313962616633333734613930303031393831313139626135343830303063633038386464343139623830333735613630316536303338363031653630333830326539303031313831323138306531383037393830653030623938313231383065303062383032306139393938306631393139323939393831303139623837343830303063303763303034346338633863393463636330386363646437383031313962613534383030306363303963303135326635633032393434353863393463636330386363646333613430303030303232363436346136363630353036303536303034323634393331383064383030386231383134383030393831303830313062313831303830303938313330303039383066303030386231393830313030343939626135343830303063633038636464343830646135656238306330343063303730303563353238386230623039393139323939393831303139626166333337346139303030313938313231396261353438303030636330393063303934633037386330343463303738303634636330393064643431396238303337356136303234363033633630323236303363303332393030313235656238306330393863303738303634303138353463636330383063386339346363633038386364633361343030303630343230303232363436343634613636363034613636656263303038636464326134303030363630353230306136363035323030633937616530313461323263363461363636303461363665316432303030303031313332333233323332353333333032633330326630303231333233323439386330383030303863303763303063353863306234303034633062343030386330616330303463303863303038353463636330393463646333613430303430303232363436343634363436343634363436343634363436343634613636363036383630366530303432363436343634363439333139323939393831613939623837343830303030303434633863386338633934636363306630633066633030383532363136333735613630376130303236303761303034366562346330656330303463306363303134353863306363303130633934636363306430636463336134303030303032326136363630366536303634303134323933306230623138313930303439383134303035313831333830353862313831613830303938316138303131626165333033333030313330333330303233373563363036323030323630363230303436303565303032363035653030343630356130303236303561303034363035363030323630343630303432633630343630303236303530303032363034303030323263363630303830313636366539353230303033333032353337353230333639376165303330313233303165303139313461323263326336303438303032363033383032633434363436363030323030323030363434613636363034383030323239383130336438376138303030313332333233323332353333333032353333373565303065303034323636653935323030303333303239303031346264373030393938303330303330303139383133303031393831323030313138313430303131383133303030393830643830613138303830303039393239393938306439396238373438303130633036383030343463303830633036343030343538633037636330383063303830633036303030343538353863303738303034633863633030343030343031343839346363633037343030343532663563303236343634613636363033383636656263633033346330363830303863303334633036383032633463633038303030386363303130303130303034346363303130303130303034633038343030386330376330303435383838636463333939393931313139313931393239393938306639396238373438303038303034353230303031333735613630343836303361303034363033613030323634613636363033633636653164323030323030313134633031303364383761383030303133323332333330303130303130303232323533333330323430303131346331303364383761383030303133323332333233323533333330323533333731653031343030343236366539353230303033333032393337353030303239376165303133333030363030363030333337356136303463303036366562386330393030303863306130303038633039383030346464353938313139383065303031313830653030303939313938303038303038303231313239393938313038303038613631303364383761383030303133323332333233323533333330323233333731653031303030343236366539353230303033333032363337346330303239376165303133333030363030363030333337353636303436303036366562386330383430303863303934303038633038633030346464353938303539383062383031316261653330306133303137303031333735633630313636303265303032393030313162616233303162303031333031623030323337353836303332303032363033323030323630333030303436303263303032363436343634363436343634363436343634363436343634363436343634363436346136363630343236366531643230303233303230303065313332333233323533333330323433333730653930303031383131383030383939383134313830623138313131383134393831313030303939383134316261373030663333303238333734653031383636303530366539383031313266356330326336343636303032303032303165343461363636303530303032323938313033643837613830303031333233323533333330323733333735653630333036303461303034303061323636653935323030303333303262303032346264373030393938303230303230303039383136303031313831353030303938313338303039383066383037306231626162333032353030313330323530303133303234303031333032333030313330323230303133303231303031333032303030313330316630303233373538363033613030323630336130303236303338303034366562306330363830303463303438303063633036303030346330363030303863303538303034633033383031633863303534303034386330353063303534303034353236313336353633323533333330306533333730653930303030303038613939393830383938303630303330613463326332613636363031633636653164323030323030313133323332353333333031333330313630303231333234393863303138303034353863303530303034633033303031383538633033303031346330303430313438633934636363303334636463336134303030303032323634363436343634613636363032383630326530303432363436343933313830343030313139323939393830393139623837343830303030303434633863386338633934636363303634633037303030383532363136333735613630333430303236303334303034366562346330363030303463303430303130353863303430303063353863303534303034633035343030386330346330303463303263303038353863303263303034386339346363633033306364633361343030303030323236343634363436346136363630323636303263303034323933306231626165333031343030313330313430303233373563363032343030323630313430303432633630313430303236656238303034646437303030393138303239626161303031323330303333373534303032616536393535636561616239653535373365616538313564306162613234633131653538316335393264653133383564363132363934656564313864373637393031633437333162333436363365366165633739626561636138386461623030346330313165353831636132326139373136666236366364366434623735346162333336306666623631613433643365633939666534386238386133646636383061303030313539306235643539306235613031303030303333323332333233323332333233323332333232333232323332333235333333303039333233323332333235333333303064333337306539303030313830363030303839393139313931393139313931393139313931393139313931393139313931393139313931393139313931393139323939393831323139623837343830303063303863303034346338633863386339346363633061306364633361343030303630346530303232363436343634613636363035363636656263303039333031303364383739383030303133323332333233323332333233323332333235333333303334333337306536363630323836343636303032303032303365343461363636303732303032323937616465663663363031333233323332333235333333303361333337316539313031303030303231303033313333303365333337363036656134303038646433303030393938303330303330303139626162333033623030333337356336303732303034363037613030343630373630303236656238633035386330633830303464643731383039393831393030306134303034323634363461363636303732363037383030343261363636303663363630323830303230303632363436343634363461363636303734363436343634363436343634363436343634363436343634363436343634363436343634613636363039386136363630393836363630393836366533636330343063303338646437313831373138323530303161343530303461303934343534636363313330636463343938303931626165333032653330346130303334383139303463393463636331333463646333613430303036303938303032323634363436346136363630613036366531643230303033303466303031313332333235333333303532353333333035323333333031323330333133303530303039323233333731323030323030343030383236363630323436303632363061303031323434363665323430303830303430303435323830613939393832393139623838343830303064643639383133313832383030343861393939383239313962383834383030306464363938303939383238303034386139393938323931396238383438303030646436393832623938326331383263313832633138326331383238303034386139393938323931396238383438303030646436393831383938323831383064313832383030343861393939383239313962383833373561363034633630613030313236656234633034636331343030323435323838623062306230623062306231383262303030393832373030303862313938303732343030343930303131383239383030393832353830303862313938303561343030343930303330623062303939323939393832363939623837333030613030323438303038346339346363633133386364633361343030303630396130303232613636363039633636656263303163303663353238386230623139383133383031303030386231383039383031386231626162333035303030313330353030303233303465303031333034363030333330346330303133303463303032333034613030313330343230306533303031303031323235333333303437303031313438303030346364633032343030343636303034303034363039343030323434613636363038363636653163303035323030303134633031303364383761383030303135333333303433333337313030303239303030303939626135343830303063633131636364643261343030303636303865366561306364633061343030303030343636303865366561306364633061343030303030323937616530346264373030393962613534383030306363313163636464326134303030363630386536656130303038636331316364643430303061356562383132663563303434343634363436343634363436363030653636653038303130646436393832363938323730303039396238323337356136303961303032303034363038613030613665623463313263303034633132633030386464363938323438303039383230383031393138323239383233313832333138323330303039383030383030393132393939383166393962386630303134383930303134383930303133323533333330343033333730653930323030303038393938303138303139393962386334383030386364633039623864303032343830303830303834303038636463373030306134303030363030323030323434613636363037613636653363303035323231303031343839303031333233323533333330336633333730653930323030303038393938303230303231393830373030313939623831303032343830303834303063636463373030313139623831303031343830303863303063303034386463363830303839393239393938316439396261663333333232323533333330336533333330336533323533333330336633333730653665623463303834633066343030353230303031333337306536656234633037386330663430303532303030313461303630383636303838363038383630383836303838363038383630373830303639343132383861363130336438376138303030313332333233323533333330343133333730653930303130303038613631303364383762383030303133323332353333333034333333373132363665303064643639383132393832303830303962616433303137333034313030383030373134633130336438376238303030313463313033643837393830303033303437303031333033663030323330336630303133333031393030323030313330303530303333303164333033393330316433303339303035333337303430303239303430343462643162616233303161333033393330316433303339303035346331303364383739383030303134613232633634613636363037363636653164323030323330336333373534363033343630373230303232363461363636303738363665316432303032333033623030313133373561363038323630373430303232633630336136303732303032326336303332363037303034303263343630303436303730303032343630376336303765363037653630376536303765363037653630376530303236343634363461363636303734363665316432303030303031313332333233323332353333333034313330343430303231333233323439386330653030303863393463636330666363646333613430303030303232363436343634363461363636303863363039323030343236343634393331393830363830313131393139313931393239393938323439396238373438303030303034346338633863386338633863393463636331343863313534303038346339323633323533333330353033333730653930303030303038393931393239393938326139383263303031306134633263366562386331353830303463313338303038353863313338303034353863313463303034633134633030386464373138323838303039383238383031316261643330346630303133303437303033313633303437303032333030663030323330343830303233303436303031333235333333303434333337306539303030303030383939313931393139313931393139313931393139313931393139313931393139323939393832623938326430303130393931393139313932346336363034303030383436346136363630623236366531643230303030303131333233323332333233323332333233323332333235333333303636333036393030323133323332343938633934636363313934636463336134303030303032323634363436343634363436343634363436343634363436346136363630653836306565303034323634393331393831643030353931626164303031313633373561363065613030323630656130303436656238633163633030346331636330303864643639383338383030393833383830313162616433303666303031333036663030323337356136306461303032363064613030343665623063316163303034633138633032343538633138633032306339346363633139306364633361343030303030323236343634363436343634363436343634363436346136363630653236306538303034323933306231626165333037323030313330373230303233373561363065303030323630653030303436656234633162383030346331623830303864643639383336303030393833363030313162616433303661303031333036323030613136333036323030393136333337306539303031313833313962616133303637303031333036373030323337356136306361303032363063613030343665623463313863303034633138633030386331383430303463313834303038633137633030346331356330303835386331356330303463303738303134633037343031386339346363633135346364633361343030303030323236343634363436346136363630623836306265303034323933306231626164333035643030313330356430303233373561363062363030323630613630316332633630613630316132633665623063313630303034633136303030386331353830303463313538303038633135303030346331353030303864643639383239303030393832393030313162616433303530303031333035303030323337356136303963303032363039633030343630393830303236303938303034366562386331323830303463313038303130353863313038303063353864643539383233383030393832333830313138323238303039383165383032306231383165383031386231383231303030393832313030313138323030303039383163303032306231383163303031393139323939393831643139623837343830303030303434633863386338633934636363313034633131303030383532363136333735613630383430303236303834303034366562346331303030303463306530303038353863306530303034383863386363303034303034303063383934636363306638303034353236313332333330303330303333303432303032333030333330343030303133303039303031313631363330336130303133323333303031303031303232323235333333303339303031313462643730303939313932393939383163313931393239393938316431396238373438303038303034346364633738316231626165333033663330333830303231346130363037303030323630333436303663363033343630366330303432363630373830303436363030383030383030323236363030383030383030323630376130303436303736303032326336366539353230303033333033373337353230346136363036653665613430303532663563303634363630303236363030343665346363633030346363303034646437313830613938313838306131626165333031323330333130313434383831303636333663363936353665373430303438306130303063383863646335303031303030393131393962386334383030303030343030386464393938303931383137313830393138313730303131393239393938313831396238373438303030303034346338633863386339346363633064636330653830303834633863393236333032653030323332353333333033353333373065393030303030303839393139313931393239393938316531383166383031306134633263366562346330663430303463306634303038646436393831643830303938313938303230623138313938303138623138316330303039383163303031313831623030303938313730303130623138313730303039383030383031393139323939393831373939623837343830313063306238303034346330643063306234303034353863303038633062303030343863306338633063636330636330303463303238633061343031383538633934636363306163636463336134303030303032326136363630356336303532303034323933306230613939393831353939623837343830303830303434633863393463636330633063306363303038346339323633303236303031313633303331303031333032393030323136333032393030313330326530303133303236303031313633333030313030613333373461393030313139383135393830343938313238303132356562383038386338636330303430303430306338393463636330623430303435333030313033643837613830303031333233323332333235333333303265333337356530306530303432363665393532303030333330333230303134626437303039393830333030333030313938313738303139383136383031313831383830313138313738303039383135303030393831313030303862313931393830303830303830613131323939393831343030303861363031303364383761383030303133323332353333333032373333303035333030363330323530303230303831333337346139303030313938313538303132356562383034636330313030313030303463306230303038633061383030343838636463333939393830323162616233303033333032323030323337356336303063363034343030323665623863303063633038383030353230303232333032373330323830303132323233323332333235333333303236333337306539303031303030386134303030323665623463306163633039303030386330393030303463393463636330393463646333613430303430303232393831303364383761383030303133323332333330303130303130303232323533333330326230303131346331303364383761383030303133323332333233323533333330326333333731653031343030343236366539353230303033333033303337353030303239376165303133333030363030363030333337356136303561303036366562386330616330303863306263303038633062343030346464353938313531383131383031313831313830303939313938303038303038303231313239393938313430303038613631303364383761383030303133323332333233323533333330323933333731653031303030343236366539353230303033333032643337346330303239376165303133333030363030363030333337353636303534303036366562386330613030303863306230303038633061383030346330303463303734303638386330393030303464643539383131303030393831313030303938313038303131383066383030393830663830303938306630303039383065383031316261623330316230303133303162303031333031613030323337353836303330303032363033303030323630326530303436656230633035343030346330333430313464643731383039383030393830353830303862313830383830303938303838303131383037383030393830333830313861346332366361633634613636363031323636653164323030303030313133323332353333333030653330313130303231333234393863303130303034353863303363303034633031633031303538633031633030633863393463636330323463646333613430303030303232363436343634363461363636303230363032363030343239333062316261653330313130303133303131303032333735633630316530303236303065303034326336303065303032366562383030343863303134646435303030393138303139626161303031353733346161653735353563663261623966353734306165383535643132363131653538316366373163393734323761653738333166303932323963636639643139336631303864666236353431643736656432346461316333643335373030303160"
)

func (suite *CardanoTestSuite) TestVerifyHeader() {
	var (
		path      *ibctesting.Path
		blockData cardano.BlockData
	)

	testCases := []struct {
		name     string
		malleate func()
		expPass  bool
	}{
		{
			name: "successful verify blockData ",
			malleate: func() {
				blockData = cardano.BlockData{
					Height: &cardano.Height{
						RevisionNumber: 0,
						RevisionHeight: 303388,
					},
					Slot:       1214030,
					Hash:       "17e149f64bcdb3c02cfaf474bda7b72c101c3d8f0ef63d98e8ab1bb1426fdef6",
					PrevHash:   "40b933e31ffbb08a719d6166bb076cdf1558f3ff6130c02acd6fa15f359a7bd5",
					EpochNo:    2,
					HeaderCbor: headerCbor,
					BodyCbor:   bodyCbor,
					EpochNonce: "05B05B22EDD9CE5A1868BF7BAF80934AB56E3D9305F385A5F68CB41848A721B1",
					Timestamp:  1707122694,
					ChainId:    chainID,
				}
			},
			expPass: true,
		},
		{
			name: "successful verify blockData 2",
			malleate: func() {
				blockData = cardano.BlockData{
					Height: &cardano.Height{
						RevisionNumber: 0,
						RevisionHeight: 303388,
					},
					Slot:       1214030,
					Hash:       "17e149f64bcdb3c02cfaf474bda7b72c101c3d8f0ef63d98e8ab1bb1426fdef6",
					PrevHash:   "40b933e31ffbb08a719d6166bb076cdf1558f3ff6130c02acd6fa15f359a7bd5",
					EpochNo:    3,
					HeaderCbor: headerCbor,
					BodyCbor:   bodyCbor,
					EpochNonce: "05B05B22EDD9CE5A1868BF7BAF80934AB56E3D9305F385A5F68CB41848A721B1",
					Timestamp:  1707122694,
					ChainId:    chainID,
				}
			},
			expPass: true,
		},
		{
			name: "Failed verify blockData ",
			malleate: func() {
				blockData = cardano.BlockData{
					Height: &cardano.Height{
						RevisionNumber: 0,
						RevisionHeight: 303388,
					},
					Slot:       1214030,
					Hash:       "17e149f64bcdb3c02cfaf474bda7b72c101c3d8f0ef63d98e8ab1bb1426fdef6",
					PrevHash:   "40b933e31ffbb08a719d6166bb076cdf1558f3ff6130c02acd6fa15f359a7bd5",
					EpochNo:    2,
					HeaderCbor: headerCbor,
					BodyCbor:   bodyCbor,
					EpochNonce: "05B05B22EDD9CE5A1868BF7BAF80934AB56E3D9305F385A5F68CB41848A721B",
					Timestamp:  1707122694,
					ChainId:    chainID,
				}
			},
			expPass: false,
		},
	}

	for _, tc := range testCases {
		tc := tc
		suite.Run(tc.name, func() {
			suite.SetupTest()

			path = NewPath(suite.chainA, suite.chainB)
			SetupCardanoClientInCosmos(suite.coordinator, path)

			tc.malleate()

			clientState := path.EndpointA.GetClientState()

			clientStore := suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)

			err := clientState.VerifyClientMessage(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, &blockData)

			if tc.expPass {
				suite.Require().NoError(err, tc.name)
			} else {
				suite.Require().Error(err)
			}
		})
	}
}

func (suite *CardanoTestSuite) TestUpdateState() {
	var (
		path          *ibctesting.Path
		clientMessage exported.ClientMessage
		clientStore   storetypes.KVStore
	)

	testCases := []struct {
		name     string
		malleate func()
		expPass  bool
	}{
		{
			"success with new height", func() {
				clientMessage = &cardano.BlockData{Height: &cardano.Height{
					RevisionNumber: 0,
					RevisionHeight: 303388,
				},
					Slot:       1214030,
					Hash:       "17e149f64bcdb3c02cfaf474bda7b72c101c3d8f0ef63d98e8ab1bb1426fdef6",
					PrevHash:   "40b933e31ffbb08a719d6166bb076cdf1558f3ff6130c02acd6fa15f359a7bd5",
					EpochNo:    3,
					HeaderCbor: headerCbor,
					BodyCbor:   bodyCbor,
					EpochNonce: "05B05B22EDD9CE5A1868BF7BAF80934AB56E3D9305F385A5F68CB41848A721B1",
					Timestamp:  1707122694,
					ChainId:    chainID}
			},
			true,
		},
	}
	for _, tc := range testCases {
		tc := tc
		suite.Run(tc.name, func() {
			suite.SetupTest()

			path = NewPath(suite.chainA, suite.chainB)
			SetupCardanoClientInCosmos(suite.coordinator, path)
			prevClientState := path.EndpointA.GetClientState()

			tc.malleate()

			clientState := path.EndpointA.GetClientState()
			clientStore = suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)
			clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, clientMessage)
			clientStateAfterUpdate := path.EndpointA.GetClientState()
			if tc.expPass {
				suite.Require().Equal(tc.expPass, clientStateAfterUpdate.GetLatestHeight().GT(prevClientState.GetLatestHeight()))

			} else {
				suite.Require().Equal(tc.expPass, !clientStateAfterUpdate.GetLatestHeight().GT(prevClientState.GetLatestHeight()))
			}

		})
	}
}