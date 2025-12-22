export namespace main {
	
	export class AppConfig {
	    token: string;
	    agentId: string;
	
	    static createFrom(source: any = {}) {
	        return new AppConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.token = source["token"];
	        this.agentId = source["agentId"];
	    }
	}

}

